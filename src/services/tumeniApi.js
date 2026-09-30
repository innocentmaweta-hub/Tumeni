import { supabase } from '../lib/supabase';

export async function getProducts() {
  if (!supabase) return { data: null, error: null, configured: false };

  // Do not embed product_images here. PostgREST requires a foreign-key
  // relationship for embedded resources, and some existing Tumeni databases
  // do not expose that relationship in the schema cache. Products themselves
  // must still load even when the optional image table relationship is absent.
  const { data: products, error } = await supabase
    .from('products')
    .select('id,name,description,price,image_url,category_id,shop_id,shops(name),categories(name)')
    .eq('available', true)
    .order('created_at', { ascending: false });

  if (error) return { data: null, error };

  const ids = (products || []).map(p => p.id).filter(Boolean);
  if (!ids.length) return { data: products || [], error: null };

  const { data: images, error: imagesError } = await supabase
    .from('product_images')
    .select('id,product_id,image_url,sort_order')
    .in('product_id', ids)
    .order('sort_order', { ascending: true });

  // Product images are optional. If the image table/relationship is not
  // available, keep the product list usable and fall back to image_url.
  if (imagesError) return { data: products || [], error: null };

  const byProduct = new Map();
  for (const image of images || []) {
    const list = byProduct.get(image.product_id) || [];
    list.push(image);
    byProduct.set(image.product_id, list);
  }

  return {
    data: (products || []).map(p => ({ ...p, product_images: byProduct.get(p.id) || [] })),
    error: null
  };
}

export async function getCurrentProfile() {
  if (!supabase) return { data: null, error: null, configured: false };

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { data: null, error: userError || null, configured: true };

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  const isDesignatedAdmin = (user.email || '').trim().toLowerCase() === 'innocentmaweta@gmail.com';

  // Authentication is authoritative for whether the customer is signed in.
  // If the profile row is temporarily unavailable, return a safe profile
  // built from the authenticated user's metadata so the UI does not show
  // "Sign in" while a valid Supabase session exists.
  if (!profile) {
    const metadata = user.user_metadata || {};
    return {
      data: {
        id: user.id,
        full_name: metadata.full_name || user.email || 'Tumeni customer',
        phone: metadata.phone || '',
        email: user.email || '',
        avatar_url: metadata.avatar_url || '',
        role: metadata.account_type === 'seller' ? 'partner' : 'customer'
      },
      error: error || null,
      configured: true
    };
  }

  return { data: isDesignatedAdmin ? { ...profile, email: user.email || '', role: 'admin' } : { ...profile, email: user.email || '' }, error: null, configured: true };
}

export async function signUp({ fullName, phone, email, password, accountType = 'customer' }) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const safeAccountType = accountType === 'seller' ? 'seller' : 'customer';
  const result = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, phone, account_type: safeAccountType },
      emailRedirectTo: 'https://tumeni.vercel.app/'
    }
  });
  if (!result.error && result.data.user && result.data.session) {
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ full_name: fullName, phone })
      .eq('id', result.data.user.id);
    if (profileError) return { ...result, error: profileError };
  }
  return result;
}

export async function signIn(email, password) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const result = await supabase.auth.signInWithPassword({ email, password });
  if (!result.error && result.data.user) {
    const metadata = result.data.user.user_metadata || {};
    await supabase.from('profiles').update({
      full_name: metadata.full_name || undefined,
      phone: metadata.phone || undefined
    }).eq('id', result.data.user.id);
  }
  return result;
}

export async function signOut() {
  if (!supabase) return { error: null };
  return supabase.auth.signOut();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Delivery-zone rules are intentionally kept in application code for now.
// The admin-managed/database-backed version will be added later.
export const DELIVERY_ZONES = [
  { id: 'lilongwe-city', name: 'Lilongwe City', areas: ['city centre', 'area 1', 'area 2', 'area 3', 'area 4', 'area 5', 'area 6', 'area 9', 'area 10', 'area 12', 'area 18', 'area 23', 'area 25', 'area 27', 'area 43', 'area 47', 'area 49'], fee: 2500, eta: '30–60 min' },
  { id: 'lilongwe-outskirts', name: 'Lilongwe Outskirts', areas: ['area 24', 'area 26', 'area 28', 'area 29', 'area 30', 'area 33', 'area 36', 'area 38', 'area 49'], fee: 3500, eta: '60–120 min' }
];

export function getDeliveryZoneForAddress(address = {}) {
  const area = String(address.area || '').trim().toLowerCase();
  const city = String(address.city || '').trim().toLowerCase();
  if (!area && !city) return { id: 'default', name: 'Standard delivery', fee: 2500, eta: '30–120 min' };
  const match = DELIVERY_ZONES.find(z => z.areas.some(a => area === a || area.includes(a)));
  if (match && (!city || city.includes('lilongwe'))) return match;
  if (city.includes('lilongwe')) return DELIVERY_ZONES[0];
  return { id: 'default', name: 'Standard delivery', fee: 2500, eta: '30–120 min' };
}

export async function createPurchaseOrder({ customerId, items, addressId, fees }) {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (!UUID_RE.test(customerId)) throw new Error('Invalid customer account ID. Please sign out and sign in again.');
  if (addressId && !UUID_RE.test(addressId)) throw new Error('Invalid delivery address ID.');
  if (!items?.length) throw new Error('Your cart is empty.');
  for (const item of items) {
    if (!UUID_RE.test(item.product_id)) throw new Error('This product is not linked to the Tumeni database yet. Please refresh and choose a published product.');
    if (item.shop_id && !UUID_RE.test(item.shop_id)) throw new Error('This product has an invalid partner shop ID.');
  }
  const subtotal = items.reduce((sum, item) => sum + Number(item.unit_price) * item.quantity, 0);
  const serviceFee = Number(fees?.serviceFee || 0);
  const deliveryFee = Number(fees?.deliveryFee || 0);
  const handlingFee = Number(fees?.handlingFee || 0);
  const total = subtotal + serviceFee + deliveryFee + handlingFee;

  const { data: order, error: orderError } = await supabase.from('orders').insert({
    customer_id: customerId,
    order_type: 'purchase',
    status: 'pending_payment',
    subtotal,
    service_fee: serviceFee,
    delivery_fee: deliveryFee,
    handling_fee: handlingFee,
    total,
    delivery_address_id: addressId || null
  }).select().single();

  if (orderError) throw orderError;

  const { error: itemsError } = await supabase.from('order_items').insert(
    items.map(item => ({
      order_id: order.id,
      product_id: item.product_id || null,
      shop_id: item.shop_id || null,
      product_name: item.product_name,
      unit_price: item.unit_price,
      quantity: item.quantity
    }))
  );

  if (itemsError) throw itemsError;
  return order;
}

export async function createTaskOrder({ customerId, description, addressId, fees, customerNotes = '' }) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const serviceFee = Number(fees?.serviceFee || 0);
  const deliveryFee = Number(fees?.deliveryFee || 0);
  const handlingFee = Number(fees?.handlingFee || 0);
  const total = serviceFee + deliveryFee + handlingFee;

  const { data: order, error: orderError } = await supabase.from('orders').insert({
    customer_id: customerId,
    order_type: 'task',
    status: 'pending_payment',
    service_fee: serviceFee,
    delivery_fee: deliveryFee,
    handling_fee: handlingFee,
    total,
    delivery_address_id: addressId || null,
    task_description: description,
    customer_notes: customerNotes || null
  }).select().single();

  if (orderError) throw orderError;

  const { error: taskError } = await supabase.from('tasks').insert({
    order_id: order.id,
    raw_request: description
  });

  if (taskError) throw taskError;
  return order;
}


export async function getSellerVerificationCandidates() {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  const { data: shops, error: shopsError } = await supabase
    .from('shops')
    .select('id,owner_id,name,location,contact_phone,description,partnership_status,created_at')
    .order('created_at', { ascending: false });
  if (shopsError) return { data: [], error: shopsError };
  const ownerIds = [...new Set((shops || []).map(s => s.owner_id).filter(Boolean))];
  let profiles = [];
  if (ownerIds.length) {
    const result = await supabase.from('profiles').select('id,full_name,phone,avatar_url,role').in('id', ownerIds);
    if (!result.error) profiles = result.data || [];
  }
  const map = new Map(profiles.map(p => [p.id, p]));
  return { data: (shops || []).map(shop => ({ ...shop, owner: map.get(shop.owner_id) || null })), error: null };
}

export async function updateSellerVerification({ shopId, status }) {
  if (!supabase) {
    return { data: null, error: new Error('Supabase is not configured.') };
  }

  if (!shopId || !status) {
    return {
      data: null,
      error: new Error('Seller and verification status are required.')
    };
  }

  const { data, error } = await supabase
    .from('shops')
    .update({ partnership_status: status })
    .eq('id', shopId)
    .select('id,partnership_status');

  if (error) {
    return { data: null, error };
  }

  return {
    data: data?.[0] || null,
    error: null
  };
}

export async function getMyShop() {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: new Error('Please sign in first.') };
  return supabase.from('shops').select('*').eq('owner_id', user.id).maybeSingle();
}

export async function createMyShop({ name, location, contactPhone, description = '' }) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Please sign in first.');
  const { data: existing } = await supabase.from('shops').select('id').eq('owner_id', user.id).maybeSingle();
  if (existing) return { data: existing, error: null };
  return supabase.from('shops').insert({
    owner_id: user.id,
    name: name.trim(),
    location: location.trim(),
    contact_phone: contactPhone.trim(),
    description: description.trim(),
    partnership_status: 'active'
  }).select().single();
}

export async function getMyProducts() {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: [], error: new Error('Please sign in first.') };

  const isAdmin = (user.email || '').trim().toLowerCase() === 'innocentmaweta@gmail.com';
  let query = supabase
    .from('products')
    .select('id,name,description,price,image_url,category_id,shop_id,available,created_at,categories(name)')
    .order('created_at', { ascending: false });

  if (isAdmin) {
    query = query.is('shop_id', null);
  } else {
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('id')
      .eq('owner_id', user.id)
      .maybeSingle();
    if (shopError) return { data: [], error: shopError };
    if (!shop) return { data: [], error: null };
    query = query.eq('shop_id', shop.id);
  }

  const { data: products, error } = await query;
  if (error) return { data: [], error };

  // Load product images separately instead of embedding product_images.
  // This avoids PostgREST schema-cache/relationship errors while ensuring
  // the Seller Center edit form receives every saved image.
  const ids = (products || []).map(p => p.id).filter(Boolean);
  if (!ids.length) return { data: products || [], error: null };

  const { data: images, error: imagesError } = await supabase
    .from('product_images')
    .select('id,product_id,image_url,sort_order')
    .in('product_id', ids)
    .order('sort_order', { ascending: true });

  // Keep the Seller Center usable if the optional table is unavailable.
  // The primary products.image_url remains available as the fallback image.
  if (imagesError) return { data: products || [], error: null };

  const byProduct = new Map();
  for (const image of images || []) {
    const list = byProduct.get(image.product_id) || [];
    list.push(image);
    byProduct.set(image.product_id, list);
  }

  return {
    data: (products || []).map(p => ({
      ...p,
      product_images: byProduct.get(p.id) || []
    })),
    error: null
  };
}


export async function getMySellerAnalytics() {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: new Error('Please sign in first.') };

  const isAdmin = (user.email || '').trim().toLowerCase() === 'innocentmaweta@gmail.com';
  let shopId = null;
  if (!isAdmin) {
    const { data: shop, error: shopError } = await supabase
      .from('shops').select('id').eq('owner_id', user.id).maybeSingle();
    if (shopError) return { data: null, error: shopError };
    shopId = shop?.id || null;
    if (!shopId) return { data: { orders: [], reviews: [] }, error: null };
  }

  const ordersQuery = supabase
    .from('order_items')
    .select('id,product_id,product_name,unit_price,quantity,line_total,shop_id,orders(status,created_at)')
    .order('id', { ascending: false });

  const scopedOrders = isAdmin ? ordersQuery.is('shop_id', null) : ordersQuery.eq('shop_id', shopId);
  const { data: orderItems, error: orderError } = await scopedOrders;
  if (orderError) return { data: { orders: [], reviews: [] }, error: orderError };

  const products = await getMyProducts();
  if (products.error) return { data: { orders: orderItems || [], reviews: [] }, error: null };

  const productIds = (products.data || []).map(p => p.id).filter(Boolean);
  let reviews = [];
  if (productIds.length) {
    const reviewResult = await supabase
      .from('product_reviews')
      .select('product_id,rating')
      .in('product_id', productIds);
    if (!reviewResult.error) reviews = reviewResult.data || [];
  }

  return { data: { orders: orderItems || [], reviews, products: products.data || [] }, error: null };
}

export async function createSellerProduct({ shopId, name, description, price, categoryId, imageUrl, imageUrls = [], available = true }) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const urls = (imageUrls.length ? imageUrls : (imageUrl ? [imageUrl] : [])).map(x => x.trim()).filter(Boolean);
  const { data, error } = await supabase.from('products').insert({
    shop_id: shopId || null,
    name: name.trim(),
    description: description?.trim() || null,
    price: Number(price),
    category_id: categoryId || null,
    image_url: urls[0] || null,
    available
  }).select().single();
  if (error) throw error;
  if (urls.length) {
    const { error: imagesError } = await supabase.from('product_images').insert(urls.map((url, index) => ({ product_id: data.id, image_url: url, sort_order: index })));
    if (imagesError) throw imagesError;
  }
  return data;
}

export async function updateSellerProduct({ id, name, description, price, categoryId, imageUrl, imageUrls = [], available }) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const urls = (imageUrls.length ? imageUrls : (imageUrl ? [imageUrl] : [])).map(x => x.trim()).filter(Boolean);
  const { data, error } = await supabase.from('products').update({
    name: name.trim(),
    description: description?.trim() || null,
    price: Number(price),
    category_id: categoryId || null,
    image_url: urls[0] || null,
    available: Boolean(available)
  }).eq('id', id).select().single();
  if (error) throw error;
  const { error: deleteError } = await supabase.from('product_images').delete().eq('product_id', id);
  if (deleteError) throw deleteError;
  if (urls.length) {
    const { error: imagesError } = await supabase.from('product_images').insert(urls.map((url, index) => ({ product_id: id, image_url: url, sort_order: index })));
    if (imagesError) throw imagesError;
  }
  return data;
}

export async function deleteSellerProduct(id) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
  return true;
}

export async function getCategories() {
  if (!supabase) return { data: [], error: null };
  return supabase.from('categories').select('id,name').order('name');
}


export async function createCategory({ name, imageUrl = '' }) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('categories').insert({
    name: name.trim(),
    image_url: imageUrl?.trim() || null
  }).select('id,name,image_url').single();
  if (error) throw error;
  return data;
}

export async function updateCategory({ id, name, imageUrl = '' }) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('categories').update({
    name: name.trim(),
    image_url: imageUrl?.trim() || null
  }).eq('id', id).select('id,name,image_url').single();
  if (error) throw error;
  return data;
}

export async function deleteCategory(id) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw error;
  return true;
}


export async function getEmployees() {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  return supabase.from('profiles').select('id,full_name,phone,avatar_url,role').eq('role','agent').order('full_name');
}

export async function getAgentAssignments() {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: [], error: new Error('Please sign in first.') };
  // Only active assignments belong on the agent work queue.
  // Keep the order/address relationship in the same query so the dashboard
  // receives everything it needs for each delivery card.
  return supabase
    .from('order_assignments')
    .select('id,order_id,agent_id,assigned_at,accepted_at,completed_at,orders(id,order_number,order_type,status,total,task_description,delivery_address:addresses(address_line,area,city))')
    .eq('agent_id', user.id)
    .is('completed_at', null)
    .order('assigned_at', { ascending: false });
}

export async function getAgentDeliveryHistory() {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: [], error: new Error('Please sign in first.') };
  return supabase
    .from('order_assignments')
    .select('id,order_id,agent_id,assigned_at,accepted_at,completed_at,orders(id,order_number,order_type,status,total,created_at,delivery_address:addresses(address_line,area,city))')
    .eq('agent_id', user.id)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(100);
}

export async function getAgentOrders() {
  const r = await getAgentAssignments();
  return { data: (r.data || []).map(x => x.orders).filter(Boolean), error: r.error };
}

export async function assignOrderToAgent({ orderId, agentId }) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  return supabase.rpc('assign_order_to_agent', { p_order_id: orderId, p_agent_id: agentId });
}

export async function getPayChanguOperators() {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  const { data, error } = await supabase.functions.invoke('paychangu-operators', { body: {} });
  return { data: data?.operators || [], error };
}

export async function initiatePayChanguCheckout({ orderId }) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  return supabase.functions.invoke('paychangu-charge', {
    body: { order_id: orderId }
  });
}

export async function updateAgentOrderStatus({ orderId, status, note = '' }) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  return supabase.rpc('agent_update_order_status', { p_order_id: orderId, p_status: status, p_note: note });
}

export async function getAdminOrders() {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  const { data, error } = await supabase
    .from('orders')
    .select('id,order_number,order_type,status,total,subtotal,service_fee,delivery_fee,handling_fee,created_at,customer_id,task_description,customer_notes,delivery_address:addresses(id,label,address_line,area,city),order_assignments(id,agent_id,assigned_at,accepted_at,completed_at,profiles(full_name,phone))')
    .order('created_at', { ascending: false });
  if (error) return { data: [], error };
  const rows = data || [];
  const customerIds = [...new Set(rows.map(o => o.customer_id).filter(Boolean))];
  let profiles = [];
  if (customerIds.length) {
    const p = await supabase.from('profiles').select('id,full_name,phone,avatar_url,role').in('id', customerIds);
    if (!p.error) profiles = p.data || [];
  }
  const profileMap = new Map(profiles.map(p => [p.id, p]));
  return {
    data: rows.map(o => ({
      ...o,
      customer: profileMap.get(o.customer_id) || null,
      assignment_agent_id: o.order_assignments?.[0]?.agent_id || '',
      assignment_agent_name: o.order_assignments?.[0]?.profiles?.full_name || ''
    })),
    error: null
  };
}

export async function getAdminDashboardAlerts() {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  const [ordersResult, shopsResult, assignmentsResult] = await Promise.all([
    supabase.from('orders').select('id,order_number,status,total,created_at,order_type').order('created_at',{ascending:false}).limit(100),
    supabase.from('shops').select('id,name,partnership_status,created_at').order('created_at',{ascending:false}).limit(100),
    supabase.from('order_assignments').select('id,order_id,agent_id,assigned_at,accepted_at,completed_at').order('assigned_at',{ascending:false}).limit(100)
  ]);
  const errors=[ordersResult.error,shopsResult.error,assignmentsResult.error].filter(Boolean);
  const orders=ordersResult.data||[], shops=shopsResult.data||[], assignments=assignmentsResult.data||[];
  const alerts=[];
  const pendingOrders=orders.filter(o=>['pending','payment_pending','processing'].includes(String(o.status||'').toLowerCase())).length;
  const unassigned=orders.filter(o=>!assignments.some(a=>a.order_id===o.id) && !['delivered','cancelled','failed','refunded'].includes(String(o.status||'').toLowerCase())).length;
  const pendingSellers=shops.filter(s=>['pending','pending_review'].includes(String(s.partnership_status||'').toLowerCase())).length;
  if(pendingOrders)alerts.push({id:'pending-orders',severity:'attention',title:'Orders need attention',detail:pendingOrders+' active or pending orders are awaiting processing.'});
  if(unassigned)alerts.push({id:'unassigned-orders',severity:'warning',title:'Orders need assignment',detail:unassigned+' active orders do not have an agent assignment.'});
  if(pendingSellers)alerts.push({id:'pending-sellers',severity:'attention',title:'Seller reviews pending',detail:pendingSellers+' seller applications are awaiting review.'});
  return {data:alerts,error:errors.length===3?errors[0]:null};
}
export async function getAdminOperationalData() {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const [shopsResult, assignmentsResult, activityResult] = await Promise.all([
    supabase.from('shops').select('id,name,partnership_status,created_at').order('created_at',{ascending:false}).limit(200),
    supabase.from('order_assignments').select('id,order_id,agent_id,assigned_at,accepted_at,completed_at').order('assigned_at',{ascending:false}).limit(200),
    supabase.from('order_status_history').select('id,order_id,status,note,created_at').order('created_at',{ascending:false}).limit(50)
  ]);
  const firstError=shopsResult.error||assignmentsResult.error||activityResult.error;
  if (firstError) return { data: null, error: firstError };
  return {
    data:{
      shops:shopsResult.data||[],
      assignments:assignmentsResult.data||[],
      activity:activityResult.data||[]
    },
    error:null
  };
}

export async function getAdminAuditLog() {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  const [historyResult, assignmentResult, shopsResult] = await Promise.all([
    supabase.from('order_status_history').select('id,order_id,status,note,created_at').order('created_at',{ascending:false}).limit(100),
    supabase.from('order_assignments').select('id,order_id,agent_id,assigned_at,accepted_at,completed_at').order('assigned_at',{ascending:false}).limit(100),
    supabase.from('shops').select('id,name,partnership_status,created_at').order('created_at',{ascending:false}).limit(50)
  ]);
  const errors=[historyResult.error,assignmentResult.error,shopsResult.error].filter(Boolean);
  if(errors.length===3)return{data:[],error:errors[0]};
  const orderIds=[...new Set([...(historyResult.data||[]).map(x=>x.order_id),...(assignmentResult.data||[]).map(x=>x.order_id)].filter(Boolean))];
  let orders=[];if(orderIds.length){const r=await supabase.from('orders').select('id,order_number,order_type').in('id',orderIds);if(!r.error)orders=r.data||[]}
  const orderMap=new Map(orders.map(x=>[x.id,x]));
  const entries=[
    ...(historyResult.data||[]).map(x=>{const o=orderMap.get(x.order_id);return{id:'status-'+x.id,type:'order',title:o?.order_number?'Order '+o.order_number:'Order status updated',detail:(x.note||String(x.status||'').replaceAll('_',' ')).trim(),status:x.status,created_at:x.created_at}}),
    ...(assignmentResult.data||[]).map(x=>{const o=orderMap.get(x.order_id);return{id:'assignment-'+x.id,type:'assignment',title:o?.order_number?'Agent assignment · '+o.order_number:'Agent assignment',detail:x.completed_at?'Assignment completed':x.accepted_at?'Assignment accepted':'Order assigned to an agent',created_at:x.completed_at||x.accepted_at||x.assigned_at}}),
    ...(shopsResult.data||[]).map(x=>({id:'seller-'+x.id,type:'seller',title:x.name||'Seller shop',detail:'Seller status: '+(x.partnership_status||'not submitted'),status:x.partnership_status||'',created_at:x.created_at}))
  ].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,150);
  return{data:entries,error:errors.length&&entries.length===0?errors[0]:null};
}
export async function createTrustReport({targetType,targetId,productId=null,shopId=null,reason,details=''}) {
  if(!supabase)return{data:null,error:new Error('Supabase is not configured.')};
  const {data:{user}}=await supabase.auth.getUser();if(!user)return{data:null,error:new Error('Please sign in to submit a report.')};
  if(!targetType||!targetId||!reason)return{data:null,error:new Error('Report type, target and reason are required.')};
  return supabase.from('trust_reports').insert({reporter_id:user.id,target_type:targetType,target_id:targetId,product_id:productId,shop_id:shopId,reason:reason.trim(),details:details.trim()||null,status:'open'}).select().single();
}
export async function getAdminTrustReports() {
  if(!supabase)return{data:[],error:new Error('Supabase is not configured.')};
  return supabase.from('trust_reports').select('id,target_type,target_id,product_id,shop_id,reason,details,status,created_at,reporter_id').order('created_at',{ascending:false}).limit(100);
}
export async function getAdminGrowthAnalytics(days = 30) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const safeDays = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
  const since = new Date(Date.now() - safeDays * 86400000).toISOString();

  const [ordersResult, itemsResult, productsResult, shopsResult] = await Promise.all([
    supabase.from('orders').select('id,status,total,order_type,customer_id,created_at').gte('created_at', since).order('created_at', { ascending: true }).limit(5000),
    supabase.from('order_items').select('id,order_id,product_id,product_name,quantity,line_total,shop_id,orders!inner(status,created_at)').gte('orders.created_at', since).limit(10000),
    supabase.from('products').select('id,name,price,available,created_at').order('created_at', { ascending: false }).limit(5000),
    supabase.from('shops').select('id,name,partnership_status,created_at').limit(1000)
  ]);

  const errors = [ordersResult.error, itemsResult.error, productsResult.error, shopsResult.error].filter(Boolean);
  if (ordersResult.error) return { data: null, error: ordersResult.error };

  const orders = ordersResult.data || [];
  const items = itemsResult.error ? [] : (itemsResult.data || []);
  const products = productsResult.error ? [] : (productsResult.data || []);
  const shops = shopsResult.error ? [] : (shopsResult.data || []);

  const valid = o => !['cancelled', 'failed', 'refunded'].includes(String(o.status || '').toLowerCase());
  const delivered = o => String(o.status || '').toLowerCase() === 'delivered';
  const active = o => valid(o) && !delivered(o);

  const revenue = orders.filter(delivered).reduce((sum, o) => sum + Number(o.total || 0), 0);
  const deliveredOrders = orders.filter(delivered);
  const activeOrders = orders.filter(active);
  const customers = new Set(orders.map(o => o.customer_id).filter(Boolean));

  const productMap = new Map();
  for (const item of items) {
    if (String(item.orders?.status || '').toLowerCase() !== 'delivered') continue;
    const key = item.product_id || item.product_name || item.id;
    const prev = productMap.get(key) || { name: item.product_name || 'Product', units: 0, revenue: 0 };
    prev.units += Number(item.quantity || 0);
    prev.revenue += Number(item.line_total || (Number(item.unit_price || 0) * Number(item.quantity || 0)));
    productMap.set(key, prev);
  }

  const topProducts = [...productMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  const trend = [];
  for (let i = safeDays - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000);
    const key = day.toISOString().slice(0, 10);
    const dayOrders = orders.filter(o => String(o.created_at || '').slice(0, 10) === key && valid(o));
    const dayDelivered = dayOrders.filter(delivered);
    trend.push({
      date: key,
      label: day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      orders: dayOrders.length,
      delivered: dayDelivered.length,
      revenue: dayDelivered.reduce((sum, o) => sum + Number(o.total || 0), 0)
    });
  }

  const previousSince = new Date(Date.now() - safeDays * 2 * 86400000).toISOString();
  const previousResult = await supabase.from('orders')
    .select('id,status,total,customer_id,created_at')
    .gte('created_at', previousSince)
    .lt('created_at', since)
    .limit(5000);
  const previousOrders = previousResult.error ? [] : (previousResult.data || []);
  const previousRevenue = previousOrders.filter(delivered).reduce((sum, o) => sum + Number(o.total || 0), 0);

  return {
    data: {
      days: safeDays,
      orders: orders.length,
      deliveredOrders: deliveredOrders.length,
      activeOrders: activeOrders.length,
      customers: customers.size,
      revenue,
      averageOrderValue: deliveredOrders.length ? revenue / deliveredOrders.length : 0,
      topProducts,
      trend,
      shops: shops.length,
      availableProducts: products.filter(p => p.available).length,
      growth: {
        revenue: previousRevenue ? ((revenue - previousRevenue) / previousRevenue) * 100 : null,
        orders: previousOrders.length ? ((orders.length - previousOrders.length) / previousOrders.length) * 100 : null
      }
    },
    error: errors.length > 1 ? errors[1] : null
  };
}

export async function updateAdminOrderStatus({ orderId, status, note = '' }) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  return supabase.rpc('admin_update_order_status', { p_order_id: orderId, p_status: status, p_note: note || null });
}

export async function cancelMyOrder({ orderId, note = '' }) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  return supabase.rpc('customer_cancel_order', { p_order_id: orderId, p_note: note || null });
}

export async function getAdminOrderDetails(orderId) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  if (!orderId) return { data: null, error: new Error('Order ID is required.') };
  const [itemsResult, historyResult] = await Promise.all([
    supabase.from('order_items').select('id,product_id,product_name,unit_price,quantity,line_total,shop_id').eq('order_id', orderId).order('id'),
    supabase.from('order_status_history').select('id,status,note,created_at').eq('order_id', orderId).order('created_at', { ascending: true })
  ]);
  return { data: { items: itemsResult.error ? [] : (itemsResult.data || []), history: historyResult.error ? [] : (historyResult.data || []) }, error: null };
}

export async function getAdminUsers() {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  const sync = await supabase.rpc('sync_auth_users_to_profiles');
  if (sync.error) return { data: [], error: sync.error };
  return supabase.from('profiles').select('id,full_name,phone,role').neq('role','admin').order('full_name');
}

export async function makeAgent(userId) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  return supabase.rpc('set_user_as_agent', { p_user_id: userId });
}


export async function getMyOrders() {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: [], error: new Error('Please sign in first.') };
  return supabase
    .from('orders')
    .select('id,order_number,order_type,status,subtotal,service_fee,delivery_fee,handling_fee,total,created_at,task_description,delivery_address:addresses(id,address_line,area,city)')
    .eq('customer_id', user.id)
    .order('created_at', { ascending: false });
}

export async function getMyOrderItems(orderId) {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  if (!orderId) return { data: [], error: new Error('Order ID is required.') };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: [], error: new Error('Please sign in first.') };
  const { data, error } = await supabase
    .from('order_items')
    .select('id,order_id,product_id,product_name,unit_price,quantity,shop_id')
    .eq('order_id', orderId)
    .order('id');
  return { data: data || [], error };
}

export async function getMyOrderHistory(orderId) {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  return supabase
    .from('order_status_history')
    .select('id,order_id,status,note,created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
}

export async function getMyAddresses() {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: [], error: new Error('Please sign in first.') };
  return supabase.from('addresses')
    .select('id,label,address_line,area,city,created_at')
    .eq('customer_id', user.id)
    .order('created_at', { ascending: false });
}

export async function createMyAddress({ label = 'Delivery address', addressLine, area = '', city = '' }) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Please sign in first.');
  const { data, error } = await supabase.from('addresses').insert({
    customer_id: user.id,
    label: label.trim() || 'Delivery address',
    address_line: addressLine.trim(),
    area: area.trim() || null,
    city: city.trim() || null
  }).select('id,label,address_line,area,city,created_at').single();
  if (error) throw error;
  return data;
}

export async function deleteMyAddress(id) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.from('addresses').delete().eq('id', id);
  if (error) throw error;
  return true;
}

export async function getMyNotifications() {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: [], error: new Error('Please sign in first.') };
  const { data, error } = await supabase
    .from('order_status_history')
    .select('id,order_id,status,note,created_at,orders!inner(order_number,order_type)')
    .eq('orders.customer_id', user.id)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) return { data: [], error };
  return {
    data: (data || []).map(n => ({
      ...n,
      title: n.status === 'delivered' ? 'Order delivered' : n.status === 'on_the_way' ? 'Order is on the way' : n.status === 'assigned' ? 'Order assigned' : 'Order update',
      text: n.note || `Order ${n.orders?.order_number || ''} is now ${String(n.status || '').replaceAll('_',' ')}.`
    })),
    error: null
  };
}


export async function getProductReviews(productId) {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  if (!productId) return { data: [], error: new Error('Product ID is required.') };
  return supabase.from('product_reviews').select('id,product_id,customer_id,reviewer_name,rating,comment,created_at,updated_at').eq('product_id', productId).order('created_at', { ascending: false });
}

export async function saveProductReview({ productId, rating, comment = '' }) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { data: null, error: userError || new Error('Please sign in to review this product.') };
  const safeRating = Number(rating);
  if (!Number.isInteger(safeRating) || safeRating < 1 || safeRating > 5) return { data: null, error: new Error('Please choose a rating from 1 to 5 stars.') };
  const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
  const reviewerName = (profile?.full_name || user.email || 'Tumeni customer').trim();
  return supabase.from('product_reviews').upsert({ product_id: productId, customer_id: user.id, reviewer_name: reviewerName, rating: safeRating, comment: comment.trim() || null, updated_at: new Date().toISOString() }, { onConflict: 'product_id,customer_id' }).select('id,product_id,customer_id,reviewer_name,rating,comment,created_at,updated_at').single();
}


export async function getOrderMessages(orderId) {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  if (!orderId) return { data: [], error: new Error('Order ID is required.') };
  const { data, error } = await supabase
    .from('order_messages')
    .select('id,order_id,sender_id,message,attachment_url,attachment_name,created_at,sender:profiles(full_name,avatar_url,role)')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (error) return { data: [], error };
  const rows = data || [];
  const withLinks = await Promise.all(rows.map(async row => {
    if (!row.attachment_url) return row;
    const signed = await supabase.storage.from('order-attachments').createSignedUrl(row.attachment_url, 3600);
    return { ...row, attachment_url: signed.data?.signedUrl || '' };
  }));
  return { data: withLinks, error: null };
}

export async function sendOrderMessage({ orderId, message = '', attachmentUrl = '', attachmentName = '' }) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const text = message.trim();
  if (!text && !attachmentUrl) return { data: null, error: new Error('Write a message or attach a file.') };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: new Error('Please sign in first.') };
  return supabase.from('order_messages').insert({
    order_id: orderId,
    sender_id: user.id,
    message: text || null,
    attachment_url: attachmentUrl || null,
    attachment_name: attachmentName || null
  }).select('id,order_id,sender_id,message,attachment_url,attachment_name,created_at,sender:profiles(full_name,avatar_url,role)').single();
}

export async function uploadOrderAttachment(file, orderId) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Please sign in first.');
  if (!file) throw new Error('Please choose a file.');
  if (!orderId) throw new Error('Order ID is required.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Attachments must be 8 MB or smaller.');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = user.id + '/' + orderId + '/' + Date.now() + '-' + safeName;
  const { error } = await supabase.storage.from('order-attachments').upload(path, file, { upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('order-attachments').getPublicUrl(path);
  return { url: path, name: file.name };
}


export async function getActivePromotions() {
  if (!supabase) return { data: [], error: null };
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('promotions')
    .select('id,name,code,scope,product_id,shop_id,discount_type,discount_value,min_order_amount,starts_at,ends_at,active')
    .eq('active', true)
    .lte('starts_at', now)
    .or('ends_at.is.null,ends_at.gte.' + now)
    .order('created_at', { ascending: false });
  return { data: data || [], error };
}

export async function getAdminPromotions() {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  return supabase.from('promotions').select('*').order('created_at', { ascending: false });
}

export async function createPromotion(payload) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const row = {
    name: String(payload.name || '').trim(),
    code: String(payload.code || '').trim().toUpperCase() || null,
    scope: payload.scope || 'global',
    product_id: payload.productId || null,
    shop_id: payload.shopId || null,
    discount_type: payload.discountType || 'percentage',
    discount_value: Number(payload.discountValue || 0),
    min_order_amount: Number(payload.minOrderAmount || 0),
    starts_at: payload.startsAt || new Date().toISOString(),
    ends_at: payload.endsAt || null,
    active: payload.active !== false
  };
  if (!row.name || row.discount_value <= 0) return { data: null, error: new Error('Enter a promotion name and a valid discount.') };
  if (row.discount_type === 'percentage' && row.discount_value > 100) return { data: null, error: new Error('Percentage discounts cannot exceed 100%.') };
  return supabase.from('promotions').insert(row).select().single();
}

export async function updatePromotion({ id, ...payload }) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  return supabase.from('promotions').update({
    name: String(payload.name || '').trim(),
    code: String(payload.code || '').trim().toUpperCase() || null,
    scope: payload.scope || 'global',
    product_id: payload.productId || null,
    shop_id: payload.shopId || null,
    discount_type: payload.discountType || 'percentage',
    discount_value: Number(payload.discountValue || 0),
    min_order_amount: Number(payload.minOrderAmount || 0),
    starts_at: payload.startsAt || null,
    ends_at: payload.endsAt || null,
    active: payload.active !== false
  }).eq('id', id).select().single();
}

export async function deletePromotion(id) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  return supabase.from('promotions').delete().eq('id', id);
}

export function promotionAmount(promotion, subtotal) {
  if (!promotion || Number(subtotal) < Number(promotion.min_order_amount || 0)) return 0;
  const base = Number(subtotal || 0);
  return promotion.discount_type === 'fixed'
    ? Math.min(base, Number(promotion.discount_value || 0))
    : Math.min(base, base * Number(promotion.discount_value || 0) / 100);
}


export async function searchTumeniProducts(query) {
  if (!supabase) {
    return { data: null, error: new Error('Supabase is not configured.') };
  }

  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) {
    return { data: null, error: new Error('Enter a product search.') };
  }

  const { data, error } = await supabase.functions.invoke('tumeni-assistant', {
    body: {
      action: 'search_products',
      query: cleanQuery
    }
  });

  return {
    data: data || null,
    error: error || (data?.error ? new Error(data.error) : null)
  };
}

export async function interpretYazaTask(request) {
  if (!supabase) {
    return { data: null, error: new Error('Supabase is not configured.') };
  }

  const cleanRequest = String(request || '').trim();
  if (!cleanRequest) {
    return { data: null, error: new Error('Enter the task request.') };
  }

  const { data, error } = await supabase.functions.invoke('tumeni-assistant', {
    body: {
      action: 'interpret_task',
      request: cleanRequest
    }
  });

  return {
    data: data || null,
    error: error || (data?.error ? new Error(data.error) : null)
  };
}

export async function askYazaAI(messages, options = {}) {
  if (!supabase) {
    return { data: null, error: new Error('Supabase is not configured.') };
  }

  if (!Array.isArray(messages) || !messages.length) {
    return { data: null, error: new Error('Enter a message first.') };
  }

  const safeMessages = messages
    .slice(-20)
    .map(message => ({
      role: message?.role === 'assistant' ? 'assistant' : 'user',
      content: String(message?.content || '').trim().slice(0, 4000)
    }))
    .filter(message => message.content);

  if (!safeMessages.length) {
    return { data: null, error: new Error('Enter a message first.') };
  }

  const { data, error } = await supabase.functions.invoke('tumeni-assistant', {
    body: {
      messages: safeMessages,
      include_catalog: options.includeCatalog !== false
    }
  });

  return {
    data: data || null,
    error: error || (data?.error ? new Error(data.error) : null)
  };
}

// Backward-compatible alias for any existing callers.
export const askTumeniAssistant = askYazaAI;


export async function getPersonalizedRecommendations(limit = 8) {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  const safeLimit = Math.max(1, Math.min(Number(limit) || 8, 24));
  const { data, error } = await supabase.rpc('get_personalized_recommendations', { p_limit: safeLimit });
  return { data: data || [], error };
}
