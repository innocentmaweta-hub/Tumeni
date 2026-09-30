import {supabase} from '../lib/supabase';

const VALID_EVENTS=new Set(['product_view','product_click','search','favorite_add','favorite_remove','category_view','cart_add']);

export async function trackCustomerBehavior({eventType,productId=null,categoryId=null,searchQuery='',metadata={}}={}){
  if(!supabase||!VALID_EVENTS.has(eventType)) return {data:null,error:null};
  const {data:{user}}=await supabase.auth.getUser();
  if(!user) return {data:null,error:null};
  const row={
    customer_id:user.id,
    event_type:eventType,
    product_id:productId||null,
    category_id:categoryId||null,
    search_query:String(searchQuery||'').trim().slice(0,200)||null,
    metadata:metadata&&typeof metadata==='object'?metadata:{}
  };
  return supabase.from('customer_behavior_events').insert(row).select('id').single();
}

export async function trackProductView(productId,metadata={}){
  return trackCustomerBehavior({eventType:'product_view',productId,metadata});
}
export async function trackProductClick(productId,metadata={}){
  return trackCustomerBehavior({eventType:'product_click',productId,metadata});
}
export async function trackSearch(searchQuery,metadata={}){
  return trackCustomerBehavior({eventType:'search',searchQuery,metadata});
}
export async function trackFavoriteChange(productId,liked,metadata={}){
  return trackCustomerBehavior({eventType:liked?'favorite_add':'favorite_remove',productId,metadata});
}
export async function trackCategoryView(categoryId,metadata={}){
  return trackCustomerBehavior({eventType:'category_view',categoryId,metadata});
}
export async function trackCartAdd(productId,metadata={}){
  return trackCustomerBehavior({eventType:'cart_add',productId,metadata});
}
