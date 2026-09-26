import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './styles.css';

const products=[
 {id:1,name:'Margherita Pizza',price:12.90,rating:4.6,category:'Pizzas',img:'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=900&q=88',desc:'Classic pizza with tomato, mozzarella and fresh basil.'},
 {id:2,name:'Gourmet Burger',price:11.50,rating:4.5,category:'Burgers',img:'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=88',desc:'Juicy grilled beef burger with fresh vegetables and our signature sauce.'},
 {id:3,name:'Mixed Sushi',price:13.90,rating:4.7,category:'Sushi',img:'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&w=900&q=88',desc:'A fresh selection of classic sushi rolls and bites.'},
 {id:4,name:'Vegetable Pasta',price:10.90,rating:4.4,category:'Salads',img:'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=900&q=88',desc:'Pasta tossed with seasonal vegetables and a light sauce.'},
 {id:5,name:'Mediterranean Chicken Bowl',price:13.90,rating:4.8,category:'Salads',img:'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=88',desc:'Grilled chicken, quinoa, fresh vegetables, feta and creamy yogurt sauce.'},
 {id:6,name:'Classic Fries',price:3.00,rating:4.6,category:'Burgers',img:'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=88',desc:'Crispy golden fries, lightly seasoned.'}
];

const money=n=>'$'+n.toFixed(2);

function Icon({type,size=21,filled=false}){
 const p={width:size,height:size,viewBox:'0 0 24 24',fill:filled?'currentColor':'none',stroke:'currentColor',strokeWidth:1.9,strokeLinecap:'round',strokeLinejoin:'round'};
 const d={
  home:<><path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 9.8V21h13V9.8"/><path d="M9.5 21v-6h5v6"/></>,
  search:<><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,
  heart:<path d="M20.8 8.7c0 5-8.8 10.3-8.8 10.3S3.2 13.7 3.2 8.7A5 5 0 0 1 12 5.4a5 5 0 0 1 8.8 3.3Z"/>,
  bag:<><path d="M5 8.5h14l-1 12H6l-1-12Z"/><path d="M9 8.5V6a3 3 0 0 1 6 0v2.5"/></>,
  user:<><circle cx="12" cy="8" r="3.4"/><path d="M5 21c.7-3.4 3-5.2 7-5.2s6.3 1.8 7 5.2"/></>,
  back:<path d="m15 18-6-6 6-6"/>, plus:<><path d="M12 5v14M5 12h14"/></>,
  minus:<path d="M5 12h14"/>, trash:<><path d="M4 7h16"/><path d="M9 7V4h6v3M7 7l1 14h8l1-14"/><path d="M10 11v6M14 11v6"/></>,
  chevron:<path d="m9 18 6-6-6-6"/>, pin:<><path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z"/><circle cx="12" cy="9" r="2.3"/></>,
  card:<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></>, help:<><circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.4 2.4 0 1 1 4 1.8c-1.2.8-1.7 1.3-1.7 2.5"/><path d="M12 17h.01"/></>,
  check:<path d="m5 12 4 4L19 6"/>
 };
 return <svg {...p}>{d[type]}</svg>
}

function BottomNav({tab,onTab,count}){
 const items=[['Home','home'],['Explore','search'],['Favorites','heart'],['Orders','bag'],['Profile','user']];
 return <nav className="bottom">{items.map(([label,icon])=><button key={label} className={tab===label?'selected':''} onClick={()=>onTab(label)}><span className="navicon"><Icon type={icon} size={20} filled={tab===label&&icon==='heart'}/>{label==='Orders'&&count>0&&<small>{count}</small>}</span><span>{label}</span></button>)}</nav>
}
function Header({title,onBack,right}){return <div className="inner-head">{onBack&&<button className="icon-btn" onClick={onBack}><Icon type="back" size={21}/></button>}<h1>{title}</h1>{right||<span className="head-spacer"/>}</div>}

function Splash({done}){
 useEffect(()=>{const t=setTimeout(done,1300);return()=>clearTimeout(t)},[done]);
 return <div className="splash"><div className="cloche">♨</div><h1>Bon<br/>Appétit</h1><div className="swoosh"/></div>
}

function ProductCard({p,liked,toggleLike,onClick}){
 return <article className="card"><div className="photo" onClick={onClick}><img src={p.img} alt={p.name}/><button className={'heart '+(liked?'on':'')} onClick={e=>{e.stopPropagation();toggleLike(p.id)}}><Icon type="heart" size={17} filled={liked}/></button></div><div className="pname">{p.name}</div><div className="meta"><strong>{money(p.price)}</strong><span><em>★</em> {p.rating}</span></div></article>
}

function Home({onProduct,liked,toggleLike,setTab}){
 const [cat,setCat]=useState('All'); const cats=['All','Pizzas','Burgers','Sushi','Salads']; const list=cat==='All'?products:products.filter(p=>p.category===cat);
 return <div className="screen content home-screen"><header className="home-head"><div><div className="hello">Good morning!</div><div className="question">What would you like to eat?</div></div><button className="avatar" onClick={()=>setTab('Profile')}><Icon type="user" size={18}/></button></header><section className="hero"><div className="hero-copy"><strong>-40%</strong><span>on your</span><span>1<sup>st</sup> order</span></div><img src="https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=88" alt="Fresh food"/></section><div className="cats">{cats.map(c=><button key={c} className={cat===c?'active':''} onClick={()=>setCat(c)}>{c}</button>)}</div><section><div className="section-head"><h2>Our suggestions</h2><button onClick={()=>setTab('Explore')}>See all</button></div><div className="grid">{list.slice(0,4).map(p=><ProductCard key={p.id} p={p} liked={liked.includes(p.id)} toggleLike={toggleLike} onClick={()=>onProduct(p)}/>)}</div></section></div>
}

function Explore({onProduct,liked,toggleLike}){
 const [cat,setCat]=useState('All'),[price,setPrice]=useState('Any'),[rating,setRating]=useState('Any');
 const filtered=useMemo(()=>products.filter(p=>(cat==='All'||p.category===cat)&&(price==='Any'||(price==='Under $10'&&p.price<10)||(price==='$10 - $20'&&p.price>=10&&p.price<=20)||(price==='Over $20'&&p.price>20))&&(rating==='Any'||(rating==='4+'&&p.rating>=4)||(rating==='4.5+'&&p.rating>=4.5))),[cat,price,rating]);
 const cuisine=x=>x==='Italian'?'Pizzas':x==='Asian'?'Sushi':x==='American'?'Burgers':x==='French'||x==='Vegetarian'?'Salads':'All';
 return <div className="screen content"><Header title="Filters" right={<button className="text-btn" onClick={()=>{setCat('All');setPrice('Any');setRating('Any')}}>Reset</button>}/><div className="filter-block"><h3>Cuisine type</h3><div className="chips">{['All','Italian','Asian','American','French','Vegetarian','Other'].map(x=><button className={cat===cuisine(x)?'active':''} onClick={()=>setCat(cuisine(x))} key={x}>{x}</button>)}</div><h3>Price</h3><div className="choice-list">{['Any','Under $10','$10 - $20','Over $20'].map(x=><button className={price===x?'chosen':''} onClick={()=>setPrice(x)} key={x}><span>{x}</span>{price===x&&<Icon type="check" size={17}/>}</button>)}</div><h3>Minimum rating</h3><div className="chips">{['Any','4+','4.5+'].map(x=><button className={rating===x?'active':''} onClick={()=>setRating(x)} key={x}>{x==='Any'?'Any':'★ '+x}</button>)}</div></div><button className="primary full">View {filtered.length} results</button><div className="explore-grid">{filtered.map(p=><ProductCard key={p.id} p={p} liked={liked.includes(p.id)} toggleLike={toggleLike} onClick={()=>onProduct(p)}/>)}</div></div>
}

function ProductDetail({p,onBack,onAdd,liked,toggleLike}){
 const [qty,setQty]=useState(1); if(!p)return null;
 return <div className="screen detail"><div className="detail-img"><img src={p.img} alt={p.name}/><button className="back-float" onClick={onBack}><Icon type="back" size={21}/></button><button className={'heart-float '+(liked?'on':'')} onClick={()=>toggleLike(p.id)}><Icon type="heart" size={20} filled={liked}/></button></div><div className="detail-body"><div className="detail-title"><div><h1>{p.name}</h1><p>{p.desc}</p></div><strong>{money(p.price)}</strong></div><div className="rating-line"><span>★ {p.rating}</span><span>• 25 min</span></div><h3>Options</h3><div className="option-row"><span>No onions</span><input type="checkbox"/></div><div className="qty-row"><span>Quantity</span><div className="qty"><button onClick={()=>setQty(Math.max(1,qty-1))}><Icon type="minus" size={15}/></button><b>{qty}</b><button onClick={()=>setQty(qty+1)}><Icon type="plus" size={15}/></button></div></div><button className="primary full" onClick={()=>onAdd(p,qty)}>Add to cart · {money(p.price*qty)}</button></div></div>
}

function Cart({cart,setCart,onCheckout,setTab}){
 const items=Object.values(cart).filter(x=>x.qty>0),subtotal=items.reduce((s,x)=>s+x.product.price*x.qty,0),delivery=items.length?2.5:0,total=subtotal+delivery;
 const change=(id,d)=>setCart(prev=>({...prev,[id]:{...prev[id],qty:Math.max(0,prev[id].qty+d)}}));
 return <div className="screen content"><Header title="My cart" onBack={()=>setTab('Home')}/>{!items.length?<div className="empty"><div className="empty-icon"><Icon type="bag" size={35}/></div><h2>Your cart is empty</h2><p>Add something delicious and it will appear here.</p><button className="primary" onClick={()=>setTab('Home')}>Browse food</button></div>:<><div className="cart-list">{items.map(({product,qty})=><div className="cart-item" key={product.id}><img src={product.img}/><div className="cart-info"><b>{product.name}</b><small>Size M</small><strong>{money(product.price)}</strong><div className="qty"><button onClick={()=>change(product.id,-1)}><Icon type="minus" size={14}/></button><span>{qty}</span><button onClick={()=>change(product.id,1)}><Icon type="plus" size={14}/></button></div></div><button className="delete" onClick={()=>setCart(prev=>({...prev,[product.id]:{...prev[product.id],qty:0}}))}><Icon type="trash" size={16}/></button></div>)}</div><div className="summary"><div><span>Subtotal</span><b>{money(subtotal)}</b></div><div><span>Delivery fee</span><b>{money(delivery)}</b></div><div className="total"><span>Total</span><b>{money(total)}</b></div></div><button className="primary full" onClick={()=>onCheckout(total)}>Checkout</button></>}</div>
}

function Checkout({total,onBack,onPaid}){
 const [method,setMethod]=useState('Card'),[done,setDone]=useState(false);
 if(done)return <div className="screen content success"><div className="success-icon"><Icon type="check" size={42}/></div><h1>Order confirmed!</h1><p>Your order has been placed successfully.</p><div className="order-number">Order #TM{Date.now().toString().slice(-6)}</div><button className="primary full" onClick={onPaid}>Track my order</button></div>;
 return <div className="screen content"><Header title="Payment" onBack={onBack}/><div className="pay-total"><span>Total to pay</span><strong>{money(total)}</strong></div><h3>Payment methods</h3><div className="payment-list">{['Card','PayPal','Mobile Money'].map(x=><button key={x} className={method===x?'pay-option chosen':'pay-option'} onClick={()=>setMethod(x)}><span className="radio"/><div><b>{x}</b><small>{x==='Card'?'•••• 4242':x==='PayPal'?'Fast and secure':'Pay with your mobile wallet'}</small></div><Icon type="card" size={20}/></button>)}</div><button className="primary full" onClick={()=>setDone(true)}>Pay {money(total)}</button></div>
}

function Orders({setTab}){
 return <div className="screen content"><Header title="Order tracking"/><div className="status-card"><div className="status-dot">✓</div><div><b>Preparing</b><small>Your order is being prepared</small></div></div><div className="steps"><span className="active">✓</span><i/><span>→</span><i/><span>⌂</span></div><h3>Order details</h3><div className="order-lines"><div>1× Gourmet Burger <b>$11.50</b></div><div>1× Classic Fries <b>$3.00</b></div><div>1× Coca-Cola <b>$2.00</b></div></div><div className="delivery"><b>Deliver to</b><p>25 Rose Street<br/>Lilongwe, Malawi</p><b>Estimated time</b><p>25–35 min</p></div><button className="primary full" onClick={()=>setTab('Home')}>View live on map</button></div>
}

function Profile({onLogin,onPayments}){
 const rows=[['Personal information','user'],['Saved addresses','pin'],['Payment methods','card'],['Order history','bag'],['Promo codes','check'],['Settings','filter'],['Help & support','help'],['About the app','help']];
 return <div className="screen content"><Header title="My account"/><div className="profile-head"><div className="profile-avatar"><Icon type="user" size={28}/></div><div><b>Julia Martin</b><small>julia.martin@mail.fr</small></div></div><div className="settings-list">{rows.map(([label,icon])=><button key={label} onClick={()=>label==='Payment methods'&&onPayments()}><span><Icon type={icon} size={17}/>{label}</span><Icon type="chevron" size={17}/></button>)}</div><button className="primary full outline" onClick={onLogin}>Log out</button></div>
}

function Login({onBack,onLogin}){
 return <div className="screen content login"><Header title="" onBack={onBack}/><div className="login-art"><div>🥗</div></div><h1>Welcome!</h1><p>Sign in to continue</p><input placeholder="Email address"/><input placeholder="Password" type="password"/><button className="forgot">Forgot password?</button><button className="primary full" onClick={onLogin}>Sign in</button><div className="or">or continue with</div><div className="socials"><button></button><button>G</button><button>✉</button></div></div>
}

function PaymentMethods({onBack}){
 const [selected,setSelected]=useState('Card'); return <div className="screen content"><Header title="Payment methods" onBack={onBack}/><div className="saved-payments">{['Card','PayPal','Apple Pay'].map(x=><button key={x} className={selected===x?'saved-payment selected':'saved-payment'} onClick={()=>setSelected(x)}><span className="radio"/><div><b>{x}</b><small>{x==='Card'?'•••• •••• •••• 4242':x==='PayPal'?'PayPal account':'Apple Pay'}</small></div><Icon type="card" size={19}/></button>)}</div><button className="primary full">Save</button></div>
}

function App(){
 const [splash,setSplash]=useState(true),[tab,setTab]=useState('Home'),[page,setPage]=useState('home'),[product,setProduct]=useState(null),[liked,setLiked]=useState([]),[cart,setCart]=useState({}),[checkoutTotal,setCheckoutTotal]=useState(0);
 const goTab=t=>{setTab(t);setProduct(null);setPage(t==='Home'?'home':t==='Explore'?'explore':t==='Orders'?'orders':t==='Profile'?'profile':'favorites')};
 const toggleLike=id=>setLiked(x=>x.includes(id)?x.filter(n=>n!==id):[...x,id]);
 const add=(p,qty=1)=>{setCart(c=>({...c,[p.id]:{product:p,qty:(c[p.id]?.qty||0)+qty}}));setPage('cart');setTab('Orders')};
 const cartCount=Object.values(cart).reduce((s,x)=>s+x.qty,0);
 if(splash)return <Splash done={()=>setSplash(false)}/>;
 let body;
 if(page==='home')body=<Home onProduct={p=>{setProduct(p);setPage('detail')}} liked={liked} toggleLike={toggleLike} setTab={goTab}/>;
 else if(page==='explore')body=<Explore onProduct={p=>{setProduct(p);setPage('detail')}} liked={liked} toggleLike={toggleLike}/>;
 else if(page==='detail')body=<ProductDetail p={product} onBack={()=>goTab('Home')} onAdd={add} liked={liked.includes(product?.id)} toggleLike={toggleLike}/>;
 else if(page==='cart')body=<Cart cart={cart} setCart={setCart} onCheckout={total=>{setCheckoutTotal(total);setPage('checkout')}} setTab={goTab}/>;
 else if(page==='checkout')body=<Checkout total={checkoutTotal} onBack={()=>setPage('cart')} onPaid={()=>{setPage('orders');setTab('Orders')}}/>;
 else if(page==='orders')body=<Orders setTab={goTab}/>;
 else if(page==='profile')body=<Profile onLogin={()=>setPage('login')} onPayments={()=>setPage('payments')}/>;
 else if(page==='login')body=<Login onBack={()=>setPage('profile')} onLogin={()=>setPage('profile')}/>;
 else if(page==='payments')body=<PaymentMethods onBack={()=>setPage('profile')}/>;
 else if(page==='favorites')body=<div className="screen content"><Header title="Favorites"/><div className="grid">{products.filter(p=>liked.includes(p.id)).map(p=><ProductCard key={p.id} p={p} liked={true} toggleLike={toggleLike} onClick={()=>{setProduct(p);setPage('detail')}}/>)}</div>{!liked.length&&<div className="empty"><div className="empty-icon"><Icon type="heart" size={35}/></div><h2>No favorites yet</h2><p>Tap the heart on a meal you love.</p></div>}</div>;
 else body=<Home onProduct={p=>{setProduct(p);setPage('detail')}} liked={liked} toggleLike={toggleLike} setTab={goTab}/>;
 return <div className="page"><main className="phone">{body}{!['detail','checkout','login','payments'].includes(page)&&<BottomNav tab={tab} onTab={goTab} count={cartCount}/>}</main></div>
}
createRoot(document.getElementById('root')).render(<App/>);