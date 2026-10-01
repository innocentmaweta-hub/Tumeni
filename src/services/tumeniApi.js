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

export async function getMySellerIntelligence(days = 30) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: new Error('Please sign in first.') };
  const isAdmin = (user.email || '').trim().toLowerCase() === 'innocentmaweta@gmail.com';
  let shopId = null;
  if (!isAdmin) {
    const { data: shop, error } = await supabase.from('shops').select('id').eq('owner_id', user.id).maybeSingle();
    if (error) return { data: null, error };
    shopId = shop?.id || null;
    if (!shopId) return { data: { insights: [], metrics: {} }, error: null };
  }
  const since = new Date(Date.now() - Math.max(1, Number(days) || 30) * 86400000).toISOString();
  const { data: products, error: productError } = await supabase.from('products')
    .select('id,name,price,available,stock_quantity,low_stock_threshold,shop_id,created_at')
    .eq(isAdmin ? 'shop_id' : 'shop_id', isAdmin ? null : shopId);
  if (productError) return { data: null, error: productError };
  const ids = (products || []).map(p => p.id).filter(Boolean);
  if (!ids.length) return { data: { insights: [], metrics: { products: 0, lowStock: 0, outOfStock: 0, hidden: 0, views: 0, cartAdds: 0, unitsSold: 0, revenue: 0 } }, error: null };
  const [eventsResult,ordersResult] = await Promise.all([
    supabase.from('customer_behavior_events').select('product_id,event_type').in('product_id',ids).gte('created_at',since).limit(50000),
    supabase.from('order_items').select('product_id,quantity,line_total,orders!inner(status,created_at)').in('product_id',ids).eq('orders.status','delivered').gte('orders.created_at',since).limit(50000)
  ]);
  if (eventsResult.error) return { data: null, error: eventsResult.error };
  if (ordersResult.error) return { data: null, error: ordersResult.error };
  const events=eventsResult.data||[], sales=ordersResult.data||[];
  const views=events.filter(e=>e.event_type==='product_view').length, cartAdds=events.filter(e=>e.event_type==='cart_add').length;
  const unitsSold=sales.reduce((s,x)=>s+Number(x.quantity||0),0), revenue=sales.reduce((s,x)=>s+Number(x.line_total||0),0);
  const lowStock=(products||[]).filter(p=>Number(p.stock_quantity||0)>0&&Number(p.stock_quantity||0)<=Number(p.low_stock_threshold??5)).length;
  const outOfStock=(products||[]).filter(p=>Number(p.stock_quantity||0)<=0).length, hidden=(products||[]).filter(p=>!p.available).length;
  const byProduct=new Map();
  for(const e of events){const x=byProduct.get(e.product_id)||{views:0,carts:0};if(e.event_type==='product_view')x.views++;if(e.event_type==='cart_add')x.carts++;byProduct.set(e.product_id,x);}
  const insights=[];
  for(const p of products||[]){const x=byProduct.get(p.id)||{views:0,carts:0};if(Number(p.stock_quantity||0)<=0) insights.push({type:'stock',severity:'high',product_id:p.id,product_name:p.name,message:'Out of stock — consider replenishing before more customers try to buy it.'});else if(Number(p.stock_quantity||0)<=Number(p.low_stock_threshold??5)) insights.push({type:'stock',severity:'medium',product_id:p.id,product_name:p.name,message:'Low stock — monitor inventory to avoid missed sales.'});if(x.views>=10&&x.carts===0) insights.push({type:'demand',severity:'medium',product_id:p.id,product_name:p.name,message:'Customers are viewing this product but no cart additions were recorded in the selected period.'});if(!p.available&&x.views>0) insights.push({type:'availability',severity:'medium',product_id:p.id,product_name:p.name,message:'This product is hidden while it has recent customer views.'});}
  return { data: { metrics:{products:products.length,lowStock,outOfStock,hidden,views,cartAdds,unitsSold,revenue}, insights:insights.slice(0,12) }, error:null };
}

export async function getMySellerForecast(days = 90) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: new Error('Please sign in first.') };
  const isAdmin = (user.email || '').trim().toLowerCase() === 'innocentmaweta@gmail.com';
  let shopId = null;
  if (!isAdmin) {
    const { data: shop, error } = await supabase.from('shops').select('id').eq('owner_id', user.id).maybeSingle();
    if (error) return { data: null, error };
    shopId = shop?.id || null;
    if (!shopId) return { data: { products: [] }, error: null };
  }
  const since = new Date(Date.now() - Math.max(30, Number(days) || 90) * 86400000).toISOString();
  const { data: products, error: pe } = await supabase.from('products')
    .select('id,name,price,available,stock_quantity,low_stock_threshold,shop_id')
    .eq('shop_id', isAdmin ? null : shopId);
  if (pe) return { data: null, error: pe };
  const ids=(products||[]).map(p=>p.id).filter(Boolean);
  if (!ids.length) return { data:{products:[]}, error:null };
  const { data:sales, error:se } = await supabase.from('order_items')
    .select('product_id,quantity,line_total,orders!inner(status,created_at)')
    .in('product_id',ids).eq('orders.status','delivered').gte('orders.created_at',since).limit(50000);
  if (se) return { data:null,error:se };
  const now=Date.now(), rows=[];
  for(const p of products||[]){
    const ps=(sales||[]).filter(x=>x.product_id===p.id);
    const last30=ps.filter(x=>now-new Date(x.orders.created_at).getTime()<=30*86400000).reduce((s,x)=>s+Number(x.quantity||0),0);
    const prev30=ps.filter(x=>{const age=now-new Date(x.orders.created_at).getTime();return age>30*86400000&&age<=60*86400000}).reduce((s,x)=>s+Number(x.quantity||0),0);
    const avgDaily=last30/30;
    const prevDaily=prev30/30;
    const trend=prevDaily>0?((avgDaily-prevDaily)/prevDaily)*100:null;
    const stock=Number(p.stock_quantity||0);
    const daysOfStock=avgDaily>0?stock/avgDaily:null;
    const forecast30=Math.round(avgDaily*30);
    const projected30=Math.max(0,Math.round(stock-forecast30));
    const status=stock<=0?'out_of_stock':avgDaily>0&&daysOfStock<=14?'replenish_soon':avgDaily>0&&daysOfStock<=30?'watch':'stable';
    rows.push({id:p.id,name:p.name,stock,avgDaily,forecast30,projected30,daysOfStock,trend,status,available:p.available!==false});
  }
  return { data:{products:rows.sort((a,b)=>(a.daysOfStock??99999)-(b.daysOfStock??99999))},error:null };
}

export async function getAdminSellerIntelligence(days = 30) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: new Error('Please sign in first.') };
  const isAdmin=(user.email||'').trim().toLowerCase()==='innocentmaweta@gmail.com';
  if(!isAdmin) return { data:null,error:new Error('Admin access required.') };
  const since=new Date(Date.now()-Math.max(7,Number(days)||30)*86400000).toISOString();
  const [sh,pr,ev,oi]=await Promise.all([
    supabase.from('shops').select('id,name'),
    supabase.from('products').select('id,name,available,stock_quantity,low_stock_threshold,shop_id'),
    supabase.from('customer_behavior_events').select('product_id,event_type').gte('created_at',since).limit(100000),
    supabase.from('order_items').select('product_id,quantity,line_total,orders!inner(status,created_at)').eq('orders.status','delivered').gte('orders.created_at',since).limit(100000)
  ]);
  for(const x of [sh,pr,ev,oi]) if(x.error) return {data:null,error:x.error};
  const rows=new Map((sh.data||[]).map(s=>[s.id,{id:s.id,name:s.name||'Unnamed seller',products:0,lowStock:0,outOfStock:0,views:0,carts:0,units:0,revenue:0}]));
  const admin={id:null,name:'Admin products',products:0,lowStock:0,outOfStock:0,views:0,carts:0,units:0,revenue:0};
  const map=new Map();
  for(const p of pr.data||[]){const r=p.shop_id?(rows.get(p.shop_id)):admin;if(!r)continue;r.products++;if(Number(p.stock_quantity||0)<=0)r.outOfStock++;else if(Number(p.stock_quantity||0)<=Number(p.low_stock_threshold??5))r.lowStock++;map.set(p.id,r);}
  for(const e of ev.data||[]){const r=map.get(e.product_id);if(r){if(e.event_type==='product_view')r.views++;if(e.event_type==='cart_add')r.carts++;}}
  for(const x of oi.data||[]){const r=map.get(x.product_id);if(r){r.units+=Number(x.quantity||0);r.revenue+=Number(x.line_total||0);}}
  const sellers=[...rows.values(),...(admin.products?[admin]:[])].sort((a,b)=>b.revenue-a.revenue);
  const totals=sellers.reduce((z,r)=>({products:z.products+r.products,lowStock:z.lowStock+r.lowStock,outOfStock:z.outOfStock+r.outOfStock,views:z.views+r.views,carts:z.carts+r.carts,units:z.units+r.units,revenue:z.revenue+r.revenue}),{products:0,lowStock:0,outOfStock:0,views:0,carts:0,units:0,revenue:0});
  return {data:{days:Math.max(7,Number(days)||30),sellers,totals},error:null};
}

export async function getMySellerRecommendations(days = 30) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: new Error('Please sign in first.') };
  const isAdmin=(user.email||'').trim().toLowerCase()==='innocentmaweta@gmail.com';
  let shopId=null;
  if(!isAdmin){const {data:shop,error}=await supabase.from('shops').select('id').eq('owner_id',user.id).maybeSingle();if(error)return{data:null,error};shopId=shop?.id||null;if(!shopId)return{data:{recommendations:[]},error:null};}
  const since=new Date(Date.now()-Math.max(7,Number(days)||30)*86400000).toISOString();
  const {data:products,error:pe}=await supabase.from('products').select('id,name,price,available,stock_quantity,low_stock_threshold,shop_id').eq('shop_id',isAdmin?null:shopId);
  if(pe)return{data:null,error:pe};
  const ids=(products||[]).map(p=>p.id);
  if(!ids.length)return{data:{recommendations:[]},error:null};
  const [ev,oi]=await Promise.all([
    supabase.from('customer_behavior_events').select('product_id,event_type').in('product_id',ids).gte('created_at',since).limit(50000),
    supabase.from('order_items').select('product_id,quantity,line_total,orders!inner(status,created_at)').in('product_id',ids).eq('orders.status','delivered').gte('orders.created_at',since).limit(50000)
  ]);
  if(ev.error)return{data:null,error:ev.error};if(oi.error)return{data:null,error:oi.error};
  const rec=[];
  for(const p of products||[]){
    const es=(ev.data||[]).filter(x=>x.product_id===p.id), sales=(oi.data||[]).filter(x=>x.product_id===p.id);
    const views=es.filter(x=>x.event_type==='product_view').length,carts=es.filter(x=>x.event_type==='cart_add').length,units=sales.reduce((s,x)=>s+Number(x.quantity||0),0);
    const stock=Number(p.stock_quantity||0), threshold=Number(p.low_stock_threshold??5);
    if(stock<=0 && views>0) rec.push({priority:'high',type:'restock',product_id:p.id,product_name:p.name,message:'Restock this product: customers are viewing it while it is out of stock.',metric:views});
    else if(stock>0&&stock<=threshold) rec.push({priority:'high',type:'restock',product_id:p.id,product_name:p.name,message:'Restock soon: inventory is at or below the low-stock threshold.',metric:stock});
    else if(views>=10&&carts>=3&&units===0) rec.push({priority:'medium',type:'demand',product_id:p.id,product_name:p.name,message:'Demand signal: customers are adding this product to carts but no delivered sales were recorded in this period.',metric:carts});
    else if(views>=20&&carts===0) rec.push({priority:'medium',type:'conversion',product_id:p.id,product_name:p.name,message:'Review this listing: it gets views but no cart additions were recorded.',metric:views});
    else if(units>=5&&stock>0&&stock<=units*1.5) rec.push({priority:'medium',type:'growth',product_id:p.id,product_name:p.name,message:'Strong sales with limited stock: consider replenishing before inventory runs low.',metric:units});
  }
  return{data:{recommendations:rec.sort((x,y)=>(x.priority==='high'?0:1)-(y.priority==='high'?0:1)).slice(0,15)},error:null};
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

export async function getAdminCustomerAnalytics(days = 30) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const safeDays = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
  const since = new Date(Date.now() - safeDays * 86400000).toISOString();

  const [periodResult, historyResult, eventsResult, profilesResult] = await Promise.all([
    supabase.from('orders')
      .select('id,customer_id,status,total,order_type,created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(10000),
    supabase.from('orders')
      .select('id,customer_id,status,total,created_at')
      .eq('status', 'delivered')
      .order('created_at', { ascending: true })
      .limit(20000),
    supabase.from('customer_behavior_events')
      .select('customer_id,event_type,created_at')
      .gte('created_at', since)
      .limit(30000),
    supabase.from('profiles')
      .select('id,full_name,phone,created_at')
      .neq('role', 'admin')
      .limit(10000)
  ]);

  if (periodResult.error) return { data: null, error: periodResult.error };

  const periodOrders = periodResult.data || [];
  const deliveredPeriod = periodOrders.filter(o => o.status === 'delivered');
  const deliveredHistory = historyResult.error ? [] : (historyResult.data || []);
  const events = eventsResult.error ? [] : (eventsResult.data || []);
  const profiles = profilesResult.error ? [] : (profilesResult.data || []);

  const firstPurchase = new Map();
  for (const order of deliveredHistory) {
    if (!order.customer_id) continue;
    const current = firstPurchase.get(order.customer_id);
    if (!current || new Date(order.created_at) < new Date(current)) {
      firstPurchase.set(order.customer_id, order.created_at);
    }
  }

  const periodCustomers = new Set(deliveredPeriod.map(o => o.customer_id).filter(Boolean));
  const newCustomers = [...periodCustomers].filter(id => {
    const first = firstPurchase.get(id);
    return first && new Date(first) >= new Date(since);
  });
  const returningCustomers = [...periodCustomers].filter(id => !newCustomers.includes(id));

  const revenue = deliveredPeriod.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const repeatCustomers = new Set(
    deliveredHistory.filter(o => o.customer_id && o.created_at >= since)
      .map(o => o.customer_id)
  );
  const customerOrderCounts = new Map();
  for (const order of deliveredPeriod) {
    if (!order.customer_id) continue;
    customerOrderCounts.set(order.customer_id, (customerOrderCounts.get(order.customer_id) || 0) + 1);
  }

  const eventCounts = events.reduce((map, event) => {
    const id = event.customer_id;
    if (!id) return map;
    const item = map.get(id) || { events: 0, productViews: 0, searches: 0, favorites: 0, cartAdds: 0 };
    item.events += 1;
    if (event.event_type === 'product_view') item.productViews += 1;
    if (event.event_type === 'search') item.searches += 1;
    if (event.event_type === 'favorite_add') item.favorites += 1;
    if (event.event_type === 'cart_add') item.cartAdds += 1;
    map.set(id, item);
    return map;
  }, new Map());

  const profileMap = new Map(profiles.map(p => [p.id, p]));
  const customerRows = [...customerOrderCounts.entries()].map(([id, orders]) => {
    const customer = profileMap.get(id) || {};
    const customerOrders = deliveredPeriod.filter(o => o.customer_id === id);
    const spending = customerOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const activity = eventCounts.get(id) || { events: 0, productViews: 0, searches: 0, favorites: 0, cartAdds: 0 };
    return {
      id,
      name: customer.full_name || 'Tumeni customer',
      phone: customer.phone || '',
      orders,
      spending,
      averageOrderValue: orders ? spending / orders : 0,
      activity: activity.events,
      firstPurchase: firstPurchase.get(id) || null
    };
  }).sort((a, b) => b.spending - a.spending).slice(0, 10);

  const activeCustomers = periodCustomers.size;
  const repeatRate = activeCustomers ? (repeatCustomers.size / activeCustomers) * 100 : 0;
  const activityCustomers = new Set(events.map(e => e.customer_id).filter(Boolean));
  const avgOrdersPerCustomer = activeCustomers ? deliveredPeriod.length / activeCustomers : 0;
  const avgActivityPerCustomer = activityCustomers.size ? events.length / activityCustomers.size : 0;

  const trend = [];
  for (let i = safeDays - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000);
    const key = day.toISOString().slice(0, 10);
    const dayOrders = deliveredPeriod.filter(o => String(o.created_at || '').slice(0, 10) === key);
    const dayCustomers = new Set(dayOrders.map(o => o.customer_id).filter(Boolean));
    trend.push({
      date: key,
      label: day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      customers: dayCustomers.size,
      orders: dayOrders.length,
      revenue: dayOrders.reduce((sum, o) => sum + Number(o.total || 0), 0)
    });
  }

  return {
    data: {
      days: safeDays,
      activeCustomers,
      newCustomers: newCustomers.length,
      returningCustomers: returningCustomers.length,
      repeatCustomers: repeatCustomers.size,
      repeatRate,
      deliveredOrders: deliveredPeriod.length,
      revenue,
      averageOrderValue: deliveredPeriod.length ? revenue / deliveredPeriod.length : 0,
      averageOrdersPerCustomer: avgOrdersPerCustomer,
      activeCustomersWithBehavior: activityCustomers.size,
      totalBehaviorEvents: events.length,
      averageActivityPerCustomer: avgActivityPerCustomer,
      customerRows,
      trend
    },
    error: historyResult.error || eventsResult.error || profilesResult.error || null
  };
}

export async function getAdminProductAnalytics(days = 30) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const safeDays = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
  const since = new Date(Date.now() - safeDays * 86400000).toISOString();

  const [productsResult, eventsResult, itemsResult, reviewsResult] = await Promise.all([
    supabase.from('products').select('id,name,price,image_url,available,stock_quantity,category_id,shop_id,created_at').limit(10000),
    supabase.from('customer_behavior_events').select('product_id,event_type,created_at').gte('created_at', since).not('product_id','is',null).limit(50000),
    supabase.from('order_items').select('product_id,product_name,quantity,line_total,order_id,orders!inner(status,created_at)').gte('orders.created_at', since).limit(50000),
    supabase.from('product_reviews').select('product_id,rating,created_at').gte('created_at', since).limit(50000)
  ]);

  if (productsResult.error) return { data: null, error: productsResult.error };
  const products = productsResult.data || [];
  const events = eventsResult.error ? [] : (eventsResult.data || []);
  const items = itemsResult.error ? [] : (itemsResult.data || []);
  const reviews = reviewsResult.error ? [] : (reviewsResult.data || []);

  const metrics = new Map();
  for (const p of products) metrics.set(p.id, {
    id:p.id,name:p.name,price:Number(p.price||0),available:p.available,stockQuantity:Number(p.stock_quantity||0),
    views:0,clicks:0,favorites:0,cartAdds:0,purchasedUnits:0,purchaseOrders:new Set(),revenue:0,ratingSum:0,ratingCount:0
  });
  for (const e of events) {
    const m=metrics.get(e.product_id); if(!m) continue;
    if(e.event_type==='product_view')m.views++;
    if(e.event_type==='product_click')m.clicks++;
    if(e.event_type==='favorite_add')m.favorites++;
    if(e.event_type==='cart_add')m.cartAdds++;
  }
  for (const item of items) {
    const m=metrics.get(item.product_id); if(!m || String(item.orders?.status||'').toLowerCase()!=='delivered') continue;
    m.purchasedUnits+=Number(item.quantity||0);
    m.purchaseOrders.add(item.order_id);
    m.revenue+=Number(item.line_total||0);
  }
  for (const r of reviews) {
    const m=metrics.get(r.product_id); if(!m) continue;
    m.ratingSum+=Number(r.rating||0); m.ratingCount++;
  }

  const rows=[...metrics.values()].map(m=>({
    id:m.id,name:m.name,price:m.price,available:m.available,stockQuantity:m.stockQuantity,
    views:m.views,clicks:m.clicks,favorites:m.favorites,cartAdds:m.cartAdds,
    purchasedUnits:m.purchasedUnits,purchaseOrders:m.purchaseOrders.size,revenue:m.revenue,
    rating:m.ratingCount?m.ratingSum/m.ratingCount:0,ratingCount:m.ratingCount,
    conversionRate:m.views?(m.purchaseOrders.size/m.views)*100:0
  })).sort((a,b)=>b.revenue-a.revenue);

  const totalViews=rows.reduce((n,r)=>n+r.views,0);
  const totalClicks=rows.reduce((n,r)=>n+r.clicks,0);
  const totalFavorites=rows.reduce((n,r)=>n+r.favorites,0);
  const totalCartAdds=rows.reduce((n,r)=>n+r.cartAdds,0);
  const totalUnits=rows.reduce((n,r)=>n+r.purchasedUnits,0);
  const totalRevenue=rows.reduce((n,r)=>n+r.revenue,0);
  const rated=rows.filter(r=>r.ratingCount);
  const trend=[];
  for(let i=safeDays-1;i>=0;i--){
    const day=new Date(Date.now()-i*86400000), key=day.toISOString().slice(0,10);
    const ev=events.filter(e=>String(e.created_at||'').slice(0,10)===key);
    const dayItems=items.filter(x=>String(x.orders?.created_at||'').slice(0,10)===key && String(x.orders?.status||'').toLowerCase()==='delivered');
    trend.push({
      date:key,label:day.toLocaleDateString(undefined,{month:'short',day:'numeric'}),
      views:ev.filter(e=>e.event_type==='product_view').length,
      clicks:ev.filter(e=>e.event_type==='product_click').length,
      cartAdds:ev.filter(e=>e.event_type==='cart_add').length,
      units:dayItems.reduce((n,x)=>n+Number(x.quantity||0),0),
      revenue:dayItems.reduce((n,x)=>n+Number(x.line_total||0),0)
    });
  }

  return {data:{
    days:safeDays,totalProducts:products.length,availableProducts:products.filter(p=>p.available).length,
    totalViews,totalClicks,totalFavorites,totalCartAdds,totalUnits,totalRevenue,
    averageRating:rated.length?rated.reduce((n,r)=>n+r.rating,0)/rated.length:0,
    overallConversionRate:totalViews?((new Set(items.filter(x=>String(x.orders?.status||'').toLowerCase()==='delivered').map(x=>x.order_id)).size/totalViews)*100):0,
    topProducts:rows.slice(0,12),trend
  },error:eventsResult.error||itemsResult.error||reviewsResult.error||null};
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
  return supabase.from('profiles').select('id,full_name,phone,role,created_at').neq('role','admin').order('full_name');
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
    .from('notifications')
    .select('id,recipient_id,notification_type,title,message,order_id,task_id,product_id,metadata,read_at,created_at')
    .eq('recipient_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return { data: [], error };
  return { data: (data || []).map(n => ({ ...n, text: n.message, read: Boolean(n.read_at) })), error: null };
}

export async function getMyUnreadNotificationCount() {
  if (!supabase) return { data: 0, error: new Error('Supabase is not configured.') };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: 0, error: null };
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', user.id)
    .is('read_at', null);
  return { data: Number(count || 0), error };
}

export async function markNotificationRead(notificationId) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  if (!notificationId) return { data: null, error: new Error('Notification ID is required.') };
  return supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', notificationId).is('read_at', null);
}

export async function markAllNotificationsRead() {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: new Error('Please sign in first.') };
  return supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('recipient_id', user.id).is('read_at', null);
}

export function subscribeToMyNotifications(userId, onNotification) {
  if (!supabase || !userId) return () => {};
  const channel = supabase.channel('tumeni-notifications-' + userId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'recipient_id=eq.' + userId }, payload => {
      onNotification?.(payload.new);
    })
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
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


export async function getAdminCampaigns() {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  return supabase.from('marketing_campaigns').select('*').order('created_at', { ascending: false });
}

export async function createMarketingCampaign(payload) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const name = String(payload.name || '').trim();
  const description = String(payload.description || '').trim() || null;
  const discountType = payload.discountType === 'fixed' ? 'fixed' : 'percentage';
  const discountValue = Number(payload.discountValue || 0);
  const productIds = Array.isArray(payload.productIds) ? payload.productIds.filter(Boolean) : [];
  const categoryIds = Array.isArray(payload.categoryIds) ? payload.categoryIds.filter(Boolean) : [];
  const customerSegment = ['all','new','returning','high_frequency','inactive'].includes(payload.customerSegment)
    ? payload.customerSegment : 'all';
  if (!name) return { data: null, error: new Error('Campaign name is required.') };
  if (discountValue < 0) return { data: null, error: new Error('Discount cannot be negative.') };
  if (discountType === 'percentage' && discountValue > 100) return { data: null, error: new Error('Percentage discounts cannot exceed 100%.') };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: new Error('Please sign in first.') };
  return supabase.from('marketing_campaigns').insert({
    name, description,
    starts_at: payload.startsAt || new Date().toISOString(),
    ends_at: payload.endsAt || null,
    discount_type: discountType,
    discount_value: discountValue,
    product_ids: productIds,
    category_ids: categoryIds,
    customer_segment: customerSegment,
    active: payload.active !== false,
    created_by: user.id
  }).select().single();
}

export async function updateMarketingCampaign({ id, ...payload }) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  if (!id) return { data: null, error: new Error('Campaign ID is required.') };
  return supabase.from('marketing_campaigns').update({
    name: String(payload.name || '').trim(),
    description: String(payload.description || '').trim() || null,
    starts_at: payload.startsAt || null,
    ends_at: payload.endsAt || null,
    discount_type: payload.discountType === 'fixed' ? 'fixed' : 'percentage',
    discount_value: Number(payload.discountValue || 0),
    product_ids: Array.isArray(payload.productIds) ? payload.productIds.filter(Boolean) : [],
    category_ids: Array.isArray(payload.categoryIds) ? payload.categoryIds.filter(Boolean) : [],
    customer_segment: ['all','new','returning','high_frequency','inactive'].includes(payload.customerSegment) ? payload.customerSegment : 'all',
    active: payload.active !== false
  }).eq('id', id).select().single();
}

export async function deleteMarketingCampaign(id) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  return supabase.from('marketing_campaigns').delete().eq('id', id);
}

export async function getActivePromotionalBanners() {
  if (!supabase) return { data: [], error: null };

  // Fetch every active banner first. Date filtering is done in JavaScript so
  // PostgREST's OR/date expression cannot accidentally reduce the carousel
  // to a single row.
  const { data, error } = await supabase
    .from('promotional_banners')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) return { data: [], error };

  const now = Date.now();
  const active = (data || []).filter(banner => {
    const startsAt = banner.starts_at ? new Date(banner.starts_at).getTime() : 0;
    const endsAt = banner.ends_at ? new Date(banner.ends_at).getTime() : null;
    return Number.isFinite(startsAt)
      && startsAt <= now
      && (endsAt === null || (Number.isFinite(endsAt) && endsAt >= now));
  });

  return { data: active, error: null };
}
export async function getAdminPromotionalBanners() {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  return supabase.from('promotional_banners').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false });
}
export async function createPromotionalBanner(payload) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const { data:{user} } = await supabase.auth.getUser();
  if (!user) return { data:null, error:new Error('Please sign in first.') };
  if (!String(payload.title||'').trim()) return { data:null, error:new Error('Banner title is required.') };
  if (payload.isExclusiveOffer===true) {
    const { error: clearError } = await supabase.from('promotional_banners').update({is_exclusive_offer:false});
    if (clearError) return { data:null, error:clearError };
  }
  return supabase.from('promotional_banners').insert({
    title:String(payload.title).trim(), subtitle:String(payload.subtitle||'').trim()||null,
    image_url:String(payload.imageUrl||'').trim()||null, button_text:String(payload.buttonText||'Shop Now').trim()||'Shop Now',
    destination:String(payload.destination||'Explore').trim()||'Explore', starts_at:payload.startsAt||new Date().toISOString(),
    ends_at:payload.endsAt||null, active:payload.active!==false, sort_order:Number(payload.sortOrder||0), is_exclusive_offer:payload.isExclusiveOffer===true, created_by:user.id
  }).select().single();
}
export async function updatePromotionalBanner({id,...payload}) {
  if (!supabase) return { data:null, error:new Error('Supabase is not configured.') };
  return supabase.from('promotional_banners').update({
    title:String(payload.title||'').trim(), subtitle:String(payload.subtitle||'').trim()||null,
    image_url:String(payload.imageUrl||'').trim()||null, button_text:String(payload.buttonText||'Shop Now').trim()||'Shop Now',
    destination:String(payload.destination||'Explore').trim()||'Explore', starts_at:payload.startsAt||null, ends_at:payload.endsAt||null,
    active:payload.active!==false, sort_order:Number(payload.sortOrder||0), is_exclusive_offer:payload.isExclusiveOffer===true
  }).eq('id',id).select().single();
}
export async function setExclusivePromotionalBanner(id) {
  if (!supabase) return { data:null, error:new Error('Supabase is not configured.') };
  if (!id) return { data:null, error:new Error('Banner ID is required.') };
  const { error: clearError } = await supabase.from('promotional_banners').update({is_exclusive_offer:false}).neq('id',id);
  if (clearError) return { data:null, error:clearError };
  return supabase.from('promotional_banners').update({is_exclusive_offer:true}).eq('id',id).select().single();
}
export async function deletePromotionalBanner(id) {
  if (!supabase) return { data:null, error:new Error('Supabase is not configured.') };
  return supabase.from('promotional_banners').delete().eq('id',id);
}


// Phase 6.4C — customer segmentation.
export function classifyCustomerSegment({ accountCreatedAt, deliveredOrders = [], now = new Date() }) {
  const createdAt = accountCreatedAt ? new Date(accountCreatedAt) : null;
  const purchases = (deliveredOrders || []).map(o => new Date(o.created_at)).filter(d => !Number.isNaN(d.getTime())).sort((a,b) => b-a);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const recentOrders = purchases.filter(d => d >= thirtyDaysAgo).length;
  const lastPurchase = purchases[0] || null;
  const accountAgeDays = createdAt ? Math.max(0, (now - createdAt) / (24 * 60 * 60 * 1000)) : null;
  if (recentOrders >= 4) return 'high_frequency';
  if (lastPurchase && lastPurchase < thirtyDaysAgo) return 'inactive';
  if ((accountAgeDays !== null && accountAgeDays <= 30 && purchases.length < 2) || purchases.length === 0) return 'new';
  return 'returning';
}

export async function getMyCustomerSegment() {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: new Error('Please sign in first.') };
  const { data: orders, error } = await supabase.from('orders').select('id,status,created_at').eq('customer_id', user.id).order('created_at', { ascending: false });
  if (error) return { data: null, error };
  const delivered = (orders || []).filter(o => o.status === 'delivered');
  return { data: { segment: classifyCustomerSegment({ accountCreatedAt: user.created_at, deliveredOrders: delivered }), deliveredOrders: delivered.length, lastPurchaseAt: delivered[0]?.created_at || null }, error: null };
}

export async function getAdminCustomerSegments() {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const [usersResult, ordersResult] = await Promise.all([getAdminUsers(), getAdminOrders()]);
  if (usersResult.error) return { data: null, error: usersResult.error };
  if (ordersResult.error) return { data: null, error: ordersResult.error };
  const now = new Date();
  const orderMap = new Map();
  for (const order of ordersResult.data || []) {
    if (!order.customer_id || order.status !== 'delivered') continue;
    const list = orderMap.get(order.customer_id) || [];
    list.push(order);
    orderMap.set(order.customer_id, list);
  }
  const rows = (usersResult.data || []).map(user => {
    const delivered = orderMap.get(user.id) || [];
    return { id:user.id, name:user.full_name||'Unnamed customer', phone:user.phone||'', segment:classifyCustomerSegment({accountCreatedAt:user.created_at,deliveredOrders:delivered,now}), deliveredOrders:delivered.length, lastPurchaseAt:delivered[0]?.created_at||null };
  });
  const counts = { new:0, returning:0, high_frequency:0, inactive:0 };
  rows.forEach(row => { counts[row.segment] = (counts[row.segment] || 0) + 1; });
  return { data:{counts,customers:rows}, error:null };
}

export async function getActiveMarketingCampaigns() {
  if (!supabase) return { data: [], error: null };
  const now = new Date().toISOString();
  const { data: campaigns, error } = await supabase.from('marketing_campaigns').select('*').eq('active', true).lte('starts_at', now).or('ends_at.is.null,ends_at.gte.' + now).order('created_at', { ascending:false });
  if (error) return { data:[], error };
  const segmentResult = await getMyCustomerSegment();
  if (segmentResult.error) return { data:campaigns||[], error:null };
  const segment = segmentResult.data?.segment || 'new';
  return { data:(campaigns||[]).filter(c=>c.customer_segment==='all'||c.customer_segment===segment), error:null };
}


export async function getAdminCampaignAnalytics(days=30) {
  if (!supabase) return { data:null, error:new Error('Supabase is not configured.') };
  const safeDays=[7,30,90].includes(Number(days))?Number(days):30;
  const since=new Date(Date.now()-safeDays*24*60*60*1000).toISOString();
  const [campaignsResult, behaviorResult, ordersResult, itemsResult] = await Promise.all([
    supabase.from('marketing_campaigns').select('*').order('created_at',{ascending:false}),
    supabase.from('customer_behavior_events').select('id,event_type,product_id,category_id,metadata,created_at').gte('created_at',since),
    supabase.from('orders').select('id,status,total,created_at,customer_id').gte('created_at',since),
    supabase.from('order_items').select('order_id,product_id,product_name,quantity,unit_price')
  ]);
  if(campaignsResult.error)return{data:null,error:campaignsResult.error};
  if(behaviorResult.error)return{data:null,error:behaviorResult.error};
  if(ordersResult.error)return{data:null,error:ordersResult.error};
  if(itemsResult.error)return{data:null,error:itemsResult.error};

  const campaigns=campaignsResult.data||[], events=behaviorResult.data||[], orders=ordersResult.data||[], items=itemsResult.data||[];
  const delivered=new Map(orders.filter(o=>o.status==='delivered').map(o=>[o.id,o]));
  const itemsByOrder=new Map();
  items.forEach(i=>{const a=itemsByOrder.get(i.order_id)||[];a.push(i);itemsByOrder.set(i.order_id,a)});

  const matchesCampaign=(c,eventOrItem)=>{
    const pid=eventOrItem?.product_id;
    const cid=eventOrItem?.category_id;
    const products=Array.isArray(c.product_ids)?c.product_ids:[];
    const categories=Array.isArray(c.category_ids)?c.category_ids:[];
    if(!products.length&&!categories.length)return true;
    return (pid&&products.includes(pid))||(cid&&categories.includes(cid));
  };
  const campaignRows=campaigns.map(c=>{
    const relevantEvents=events.filter(e=>matchesCampaign(c,e));
    const impressions=relevantEvents.filter(e=>e.event_type==='banner_impression'||e.event_type==='promotion_impression').length;
    const clicks=relevantEvents.filter(e=>e.event_type==='banner_click'||e.event_type==='promotion_click').length;
    const views=relevantEvents.filter(e=>e.event_type==='product_view').length;
    const cartAdds=relevantEvents.filter(e=>e.event_type==='cart_add').length;
    const productIds=new Set((c.product_ids||[]));
    const categoryIds=new Set((c.category_ids||[]));
    const campaignOrders=orders.filter(o=>{
      const oi=itemsByOrder.get(o.id)||[];
      return oi.some(i=>productIds.has(i.product_id)) || (productIds.size===0&&categoryIds.size===0);
    });
    const deliveredOrders=campaignOrders.filter(o=>o.status==='delivered');
    const revenue=deliveredOrders.reduce((s,o)=>s+Number(o.total||0),0);
    const units=deliveredOrders.reduce((s,o)=>(s+(itemsByOrder.get(o.id)||[]).filter(i=>productIds.size===0||productIds.has(i.product_id)).reduce((x,i)=>x+Number(i.quantity||0),0)),0);
    const discountAmount=deliveredOrders.reduce((s,o)=>s+Number(o.discount_amount||0),0);
    return {...c,impressions,clicks,views,cartAdds,orders:campaignOrders.length,deliveredOrders:deliveredOrders.length,unitsSold:units,revenue,discountAmount,clickRate:impressions?(clicks/impressions)*100:0,orderRate:clicks?(campaignOrders.length/clicks)*100:0};
  });
  const daily={};
  for(let i=0;i<safeDays;i++){const d=new Date(Date.now()-i*24*60*60*1000);const key=d.toISOString().slice(0,10);daily[key]={date:key,impressions:0,clicks:0,views:0,cartAdds:0,orders:0,revenue:0};}
  campaignRows.forEach(c=>{});
  events.forEach(e=>{
    const key=e.created_at?.slice(0,10); if(!daily[key])return;
    if(['banner_impression','promotion_impression'].includes(e.event_type))daily[key].impressions++;
    if(['banner_click','promotion_click'].includes(e.event_type))daily[key].clicks++;
    if(e.event_type==='product_view')daily[key].views++;
    if(e.event_type==='cart_add')daily[key].cartAdds++;
  });
  orders.filter(o=>o.status==='delivered').forEach(o=>{const key=o.created_at?.slice(0,10);if(daily[key]){daily[key].orders++;daily[key].revenue+=Number(o.total||0)}});
  const totals=campaignRows.reduce((a,c)=>{a.impressions+=c.impressions;a.clicks+=c.clicks;a.views+=c.views;a.cartAdds+=c.cartAdds;a.orders+=c.deliveredOrders;a.unitsSold+=c.unitsSold;a.revenue+=c.revenue;a.discountAmount+=c.discountAmount;return a},{impressions:0,clicks:0,views:0,cartAdds:0,orders:0,unitsSold:0,revenue:0,discountAmount:0});
  return {data:{days:safeDays,totals,campaigns:campaignRows,daily:Object.values(daily).sort((a,z)=>a.date.localeCompare(z.date))},error:null};
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
    active: payload.active !== false,
    campaign_id: payload.campaignId || null
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


export async function triggerMyRetentionEngagement() {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const { data, error } = await supabase.rpc('trigger_my_retention_engagement');
  return { data: data || null, error };
}

export async function getAdminRetentionAnalytics(days = 30) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const { data, error } = await supabase.rpc('get_admin_retention_analytics', { p_days: Number(days) || 30 });
  return { data: Array.isArray(data) ? (data[0] || null) : (data || null), error };
}

export async function triggerAbandonedCartEngagement(hasItems) {
  if (!supabase || !hasItems) return { data: null, error: null };
  const { data, error } = await supabase.rpc('trigger_my_cart_engagement');
  return { data: data || null, error };
}

export async function getMyRetentionSummary() {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const { data, error } = await supabase.rpc('get_my_retention_summary');
  return { data: Array.isArray(data) ? (data[0] || null) : (data || null), error };
}

export async function getPopularSearches(limit = 8) {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  const safeLimit = Math.max(1, Math.min(Number(limit) || 8, 20));
  const { data, error } = await supabase.rpc('get_popular_searches', { p_limit: safeLimit });
  return { data: data || [], error };
}

export async function advancedSearchProducts({ query = '', limit = 40, offset = 0 } = {}) {
  if (!supabase) return { data: [], error: new Error('Supabase is not configured.') };
  const cleanQuery = String(query || '').trim();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 40, 100));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const { data, error } = await supabase.rpc('search_products_advanced', {
    p_query: cleanQuery,
    p_limit: safeLimit,
    p_offset: safeOffset
  });
  if (error) return { data: [], error };
  return {
    data: (data || []).map(p => ({ ...p, shop: p.shop || 'Admin Product', rating: Number(p.rating || 0) })),
    error: null
  };
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

export async function getAdminOperationsAnalytics(days = 30) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const since = new Date(Date.now() - Number(days) * 86400000).toISOString();

  const [ordersResult, assignmentsResult, tasksResult] = await Promise.all([
    supabase.from('orders').select('id,order_type,status,total,created_at,updated_at').gte('created_at', since),
    supabase.from('order_assignments').select('id,order_id,agent_id,assigned_at,accepted_at,completed_at').gte('assigned_at', since),
    supabase.from('tasks').select('id,order_id,assigned_employee_id,quoted_amount,completed_at,created_at').gte('created_at', since)
  ]);
  if (ordersResult.error) return { data: null, error: ordersResult.error };
  if (assignmentsResult.error) return { data: null, error: assignmentsResult.error };
  if (tasksResult.error) return { data: null, error: tasksResult.error };

  const orders = ordersResult.data || [];
  const assignments = assignmentsResult.data || [];
  const tasks = tasksResult.data || [];
  const delivered = orders.filter(o => o.status === 'delivered');
  const failed = orders.filter(o => ['failed','cancelled'].includes(o.status));
  const completedAssignments = assignments.filter(a => a.completed_at);
  const deliveryTimes = completedAssignments.map(a => new Date(a.completed_at)-new Date(a.assigned_at)).filter(n => Number.isFinite(n) && n >= 0);
  const taskTimes = tasks.filter(t => t.completed_at).map(t => new Date(t.completed_at)-new Date(t.created_at)).filter(n => Number.isFinite(n) && n >= 0);
  const avgMinutes = values => values.length ? Math.round(values.reduce((a,b)=>a+b,0)/values.length/60000) : 0;
  const statusCounts = {};
  for (const o of orders) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
  const agentMap = {};
  for (const a of assignments) {
    const id = a.agent_id || 'unassigned';
    agentMap[id] ||= { agentId:id, assigned:0, completed:0, active:0 };
    agentMap[id].assigned++;
    if (a.completed_at) agentMap[id].completed++;
    else agentMap[id].active++;
  }
  const daily = {};
  for (const o of orders) {
    const day = String(o.created_at).slice(0,10);
    daily[day] ||= {date:day,orders:0,delivered:0,failed:0,revenue:0};
    daily[day].orders++;
    if(o.status==='delivered') daily[day].delivered++;
    if(['failed','cancelled'].includes(o.status)) daily[day].failed++;
    if(o.status==='delivered') daily[day].revenue += Number(o.total||0);
  }
  return { data:{
    periodDays:Number(days), totalOrders:orders.length, deliveredOrders:delivered.length,
    failedOrders:failed.length, deliverySuccessRate:orders.length?Math.round(delivered.length/orders.length*100):0,
    averageDeliveryMinutes:avgMinutes(deliveryTimes), averageTaskCompletionMinutes:avgMinutes(taskTimes),
    activeAssignments:assignments.filter(a=>!a.completed_at).length,
    completedAssignments:completedAssignments.length, totalAssignments:assignments.length,
    agentsTracked:Object.keys(agentMap).filter(k=>k!=='unassigned').length,
    unassignedOrders:orders.filter(o=>!assignments.some(a=>a.order_id===o.id)).length,
    statusCounts, agentWorkload:Object.values(agentMap).sort((a,b)=>b.assigned-a.assigned),
    daily:Object.values(daily).sort((a,b)=>a.date.localeCompare(b.date))
  }, error:null };
}


export async function getAdminOperationsControlCenter(){
  if(!supabase) return {data:null,error:new Error('Supabase is not configured.')};
  const {data:{user}}=await supabase.auth.getUser();
  if(!user) return {data:null,error:new Error('Please sign in first.')};
  if((user.email||'').trim().toLowerCase()!=='innocentmaweta@gmail.com') return {data:null,error:new Error('Admin access required.')};
  const [orders,assignments,tasks]=await Promise.all([
    supabase.from('orders').select('id,status,created_at,customer_id').order('created_at',{ascending:false}).limit(500),
    supabase.from('order_assignments').select('id,order_id,agent_id,assigned_at,accepted_at,completed_at').order('assigned_at',{ascending:false}).limit(500),
    supabase.from('tasks').select('id,customer_id,assigned_employee_id,customer_approved_at,completed_at,created_at,deadline_at').order('created_at',{ascending:false}).limit(500)
  ]);
  for(const r of [orders,assignments,tasks]) if(r.error) return {data:null,error:r.error};
  const os=orders.data||[], as=assignments.data||[], ts=tasks.data||[];
  const activeStatuses=['paid','assigned','preparing','shopping','picked_up','on_the_way'];
  const statusCounts={}; os.forEach(o=>{statusCounts[o.status]=(statusCounts[o.status]||0)+1});
  const assignedOrderIds=new Set(as.filter(a=>!a.completed_at).map(a=>a.order_id));
  const activeOrders=os.filter(o=>activeStatuses.includes(o.status));
  const unassignedOrders=os.filter(o=>activeStatuses.includes(o.status)&&!assignedOrderIds.has(o.id));
  const activeAssignments=as.filter(a=>!a.completed_at).length;
  const completedAssignments=as.filter(a=>a.completed_at).length;
  const activeTasks=ts.filter(t=>!t.completed_at&&t.customer_approved_at).length;
  const unassignedTasks=ts.filter(t=>!t.completed_at&&t.customer_approved_at&&!t.assigned_employee_id).length;
  const overdueTasks=ts.filter(t=>!t.completed_at&&t.deadline_at&&new Date(t.deadline_at).getTime()<Date.now()).length;
  return {data:{orders:os.length,activeOrders:activeOrders.length,unassignedOrders:unassignedOrders.length,activeAssignments,completedAssignments,activeTasks,unassignedTasks,overdueTasks,statusCounts,recentOrders:os.slice(0,12),recentTasks:ts.slice(0,12)},error:null};
}

export async function getAdminAssignmentIntelligence(){
  if(!supabase) return {data:null,error:new Error('Supabase is not configured.')};
  const {data:{user}}=await supabase.auth.getUser();
  if(!user) return {data:null,error:new Error('Please sign in first.')};
  if((user.email||'').trim().toLowerCase()!=='innocentmaweta@gmail.com') return {data:null,error:new Error('Admin access required.')};
  const [profiles,assignments,orders,tasks]=await Promise.all([
    supabase.from('profiles').select('id,full_name,role'),
    supabase.from('order_assignments').select('id,order_id,agent_id,assigned_at,accepted_at,completed_at').order('assigned_at',{ascending:false}).limit(1000),
    supabase.from('orders').select('id,order_number,status,created_at').in('status',['paid','assigned','preparing','shopping','picked_up','on_the_way']).order('created_at',{ascending:true}).limit(500),
    supabase.from('tasks').select('id,assigned_employee_id,customer_approved_at,completed_at,created_at,deadline_at').is('completed_at',null).not('customer_approved_at','is',null).limit(500)
  ]);
  for(const r of [profiles,assignments,orders,tasks]) if(r.error) return {data:null,error:r.error};
  const people=(profiles.data||[]).filter(p=>p.role==='agent'); const amap=new Map(people.map(p=>[p.id,{id:p.id,name:p.full_name||'Unnamed employee',activeAssignments:0,completedAssignments:0,activeTasks:0}]));
  const activeOrderIds=new Set((orders.data||[]).map(o=>o.id));
  for(const a of assignments.data||[]){const x=amap.get(a.agent_id);if(!x)continue;if(a.completed_at)x.completedAssignments++;else if(activeOrderIds.has(a.order_id))x.activeAssignments++;}
  for(const t of tasks.data||[]){const x=amap.get(t.assigned_employee_id);if(x)x.activeTasks++;}
  const unassignedOrders=(orders.data||[]).filter(o=>!(assignments.data||[]).some(a=>a.order_id===o.id&&!a.completed_at));
  const unassignedTasks=(tasks.data||[]).filter(t=>!t.assigned_employee_id);
  return {data:{employees:[...amap.values()].sort((a,b)=>(b.activeAssignments+b.activeTasks)-(a.activeAssignments+a.activeTasks)),unassignedOrders,unassignedTasks},error:null};
}

export async function getAdminDeliveryTaskMonitoring(){
  if(!supabase) return {data:null,error:new Error('Supabase is not configured.')};
  const {data:{user}}=await supabase.auth.getUser();
  if(!user) return {data:null,error:new Error('Please sign in first.')};
  if((user.email||'').trim().toLowerCase()!=='innocentmaweta@gmail.com') return {data:null,error:new Error('Admin access required.')};
  const [orders,assignments,tasks]=await Promise.all([
    supabase.from('orders').select('id,order_number,status,created_at').in('status',['paid','assigned','preparing','shopping','picked_up','on_the_way']).order('created_at',{ascending:true}).limit(500),
    supabase.from('order_assignments').select('id,order_id,agent_id,assigned_at,accepted_at,completed_at').order('assigned_at',{ascending:false}).limit(1000),
    supabase.from('tasks').select('id,raw_request,assigned_employee_id,customer_approved_at,completed_at,created_at,deadline_at,quoted_amount').order('created_at',{ascending:true}).limit(500)
  ]);
  for(const r of [orders,assignments,tasks]) if(r.error) return {data:null,error:r.error};
  const amap=new Map((assignments.data||[]).map(a=>[a.order_id,a]));
  const deliveryRows=(orders.data||[]).map(o=>{const a=amap.get(o.id);const waitingSince=a?.accepted_at||a?.assigned_at||o.created_at;return {...o,assignment:a||null,waitingMinutes:Math.max(0,Math.floor((Date.now()-new Date(waitingSince).getTime())/60000))};});
  const activeTasks=(tasks.data||[]).filter(t=>!t.completed_at&&t.customer_approved_at).map(t=>({...t,waitingMinutes:Math.max(0,Math.floor((Date.now()-new Date(t.assigned_employee_id? t.created_at : t.customer_approved_at||t.created_at).getTime())/60000))}));
  const overdueTasks=activeTasks.filter(t=>t.deadline_at&&new Date(t.deadline_at).getTime()<Date.now());
  return {data:{deliveries:deliveryRows,activeTasks,overdueTasks,summary:{activeDeliveries:deliveryRows.length,assignedDeliveries:deliveryRows.filter(x=>x.assignment&&!x.assignment.completed_at).length,unassignedDeliveries:deliveryRows.filter(x=>!x.assignment||x.assignment.completed_at).length,activeTasks:activeTasks.length,overdueTasks:overdueTasks.length}},error:null};
}

export async function getAdminOperationalAlerts(){
  if(!supabase) return {data:null,error:new Error('Supabase is not configured.')};
  const {data:{user}}=await supabase.auth.getUser();
  if(!user) return {data:null,error:new Error('Please sign in first.')};
  if((user.email||'').trim().toLowerCase()!=='innocentmaweta@gmail.com') return {data:null,error:new Error('Admin access required.')};
  const [orders,assignments,tasks]=await Promise.all([
    supabase.from('orders').select('id,order_number,status,created_at').in('status',['paid','assigned','preparing','shopping','picked_up','on_the_way']).order('created_at',{ascending:true}).limit(500),
    supabase.from('order_assignments').select('id,order_id,agent_id,assigned_at,accepted_at,completed_at').order('assigned_at',{ascending:false}).limit(1000),
    supabase.from('tasks').select('id,raw_request,assigned_employee_id,customer_approved_at,completed_at,created_at,deadline_at').is('completed_at',null).not('customer_approved_at','is',null).order('created_at',{ascending:true}).limit(500)
  ]);
  for(const x of [orders,assignments,tasks]) if(x.error) return {data:null,error:x.error};
  const as=assignments.data||[], activeOrders=orders.data||[], alerts=[];
  const assignmentByOrder=new Map(); for(const a of as){if(!a.completed_at&&!assignmentByOrder.has(a.order_id)) assignmentByOrder.set(a.order_id,a);}
  for(const o of activeOrders){const age=Math.floor((Date.now()-new Date(o.created_at).getTime())/60000);const a=assignmentByOrder.get(o.id);if(!a) alerts.push({severity:age>=60?'high':'medium',type:'unassigned_order',title:'Order needs assignment',message:(o.order_number||o.id)+' has been active for '+age+' minutes.'});else if(age>=180&&!a.accepted_at) alerts.push({severity:'high',type:'unaccepted_assignment',title:'Assignment not accepted',message:(o.order_number||o.id)+' has an assignment that has not been accepted.'});else if(age>=360) alerts.push({severity:'high',type:'long_running_order',title:'Order running long',message:(o.order_number||o.id)+' has been active for '+age+' minutes.'});}
  for(const t of tasks.data||[]){const age=Math.floor((Date.now()-new Date(t.created_at).getTime())/60000);if(!t.assigned_employee_id) alerts.push({severity:age>=60?'high':'medium',type:'unassigned_task',title:'Task needs assignment',message:String(t.raw_request||'Customer task').slice(0,100)});if(t.deadline_at&&new Date(t.deadline_at).getTime()<Date.now()) alerts.push({severity:'high',type:'overdue_task',title:'Task is overdue',message:String(t.raw_request||'Customer task').slice(0,100)});}
  const rank={high:0,medium:1,low:2}; alerts.sort((a,b)=>rank[a.severity]-rank[b.severity]);
  return {data:{alerts:alerts.slice(0,50),summary:{high:alerts.filter(a=>a.severity==='high').length,medium:alerts.filter(a=>a.severity==='medium').length,total:alerts.length}},error:null};
}