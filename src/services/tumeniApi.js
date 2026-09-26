import { supabase } from '../lib/supabase';

export async function getProducts() {
  if (!supabase) return { data: null, error: null, configured: false };
  return supabase
    .from('products')
    .select('id,name,description,price,image_url,category_id,shop_id,shops(name),categories(name)')
    .eq('available', true)
    .order('created_at', { ascending: false });
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
        role: metadata.account_type === 'seller' ? 'partner' : 'customer'
      },
      error: error || null,
      configured: true
    };
  }

  return { data: isDesignatedAdmin ? { ...profile, role: 'admin' } : profile, error: null, configured: true };
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
  const query = supabase
    .from('products')
    .select('id,name,description,price,image_url,category_id,shop_id,available,created_at,categories(name)')
    .order('created_at', { ascending: false });
  if (isAdmin) return query.is('shop_id', null);

  const { data: shop, error: shopError } = await supabase
    .from('shops')
    .select('id')
    .eq('owner_id', user.id)
    .maybeSingle();
  if (shopError) return { data: [], error: shopError };
  if (!shop) return { data: [], error: null };
  return query.eq('shop_id', shop.id);
}

export async function createSellerProduct({ shopId, name, description, price, categoryId, imageUrl, available = true }) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('products').insert({
    shop_id: shopId || null,
    name: name.trim(),
    description: description?.trim() || null,
    price: Number(price),
    category_id: categoryId || null,
    image_url: imageUrl?.trim() || null,
    available
  }).select().single();
  if (error) throw error;
  return data;
}

export async function updateSellerProduct({ id, name, description, price, categoryId, imageUrl, available }) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('products').update({
    name: name.trim(),
    description: description?.trim() || null,
    price: Number(price),
    category_id: categoryId || null,
    image_url: imageUrl?.trim() || null,
    available: Boolean(available)
  }).eq('id', id).select().single();
  if (error) throw error;
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
