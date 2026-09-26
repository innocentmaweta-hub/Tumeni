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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: null, configured: true };
  return supabase.from('profiles').select('*').eq('id', user.id).single();
}

export async function signUp({ fullName, phone, email, password }) {
  if (!supabase) return { data: null, error: new Error('Supabase is not configured.') };
  const result = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, phone },
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

export async function createPurchaseOrder({ customerId, items, addressId, fees }) {
  if (!supabase) throw new Error('Supabase is not configured.');
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
