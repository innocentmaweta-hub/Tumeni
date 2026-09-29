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

export async function createTaskOrder({ customerId, description, addressId, fees }) {
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
    task_description: description
  }).select().single();

  if (orderError) throw orderError;

  const { error: taskError } = await supabase.from('tasks').insert({
    order_id: order.id,
    raw_request: description
  });

  if (taskError) throw taskError;
  return order;
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
    .select('id,order_number,order_type,status,total,created_at,order_assignments(id,agent_id,profiles(full_name))')
    .order('created_at', { ascending: false });
  if (error) return { data: [], error };
  return {
    data: (data || []).map(o => ({
      ...o,
      assignment_agent_id: o.order_assignments?.[0]?.agent_id || ''
    })),
    error: null
  };
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
