import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import './styles.css';

const products=[
 {name:'Margherita Pizza',price:'$12.90',rating:'4.6',img:'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=700&q=85'},
 {name:'Gourmet Burger',price:'$11.50',rating:'4.5',img:'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=700&q=85'},
 {name:'Mixed Sushi',price:'$13.90',rating:'4.7',img:'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&w=700&q=85'},
 {name:'Vegetable Pasta',price:'$10.90',rating:'4.4',img:'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=700&q=85'}
];

const categories=['All','Pizzas','Burgers','Sushi','Salads'];

function Icon({type,size=21,filled=false}){
 const p={width:size,height:size,viewBox:'0 0 24 24',fill:filled?'currentColor':'none',stroke:'currentColor',strokeWidth:1.9,strokeLinecap:'round',strokeLinejoin:'round'};
 const paths={
  home:<><path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 9.8V21h13V9.8"/><path d="M9.5 21v-6h5v6"/></>,
  search:<><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,
  heart:<path d="M20.8 8.7c0 5-8.8 10.3-8.8 10.3S3.2 13.7 3.2 8.7A5 5 0 0 1 12 5.4a5 5 0 0 1 8.8 3.3Z"/>,
  bag:<><path d="M5 8.5h14l-1 12H6l-1-12Z"/><path d="M9 8.5V6a3 3 0 0 1 6 0v2.5"/></>,
  user:<><circle cx="12" cy="8" r="3.4"/><path d="M5 21c.7-3.4 3-5.2 7-5.2s6.3 1.8 7 5.2"/></>,
  plus:<><path d="M12 5v14M5 12h14"/></>
 };
 return <svg {...p}>{paths[type]}</svg>
}

function App(){
 const [activeCat,setActiveCat]=useState('All');
 const [tab,setTab]=useState('Home');
 const [liked,setLiked]=useState([]);
 const [cart,setCart]=useState(0);
 const visible=activeCat==='All'?products:products.filter((_,i)=>['Pizzas','Burgers','Sushi','Salads'].indexOf(activeCat)===i);
 const nav=[['Home','home'],['Explore','search'],['Favorites','heart'],['Orders','bag'],['Profile','user']];
 return <div className="page">
  <main className="phone">
   <div className="status"><span>9:41</span><span className="status-icons"><b></b><b></b><b></b><i></i></span></div>
   <div className="content">
    <header>
      <div><div className="hello">Good morning!</div><div className="question">What would you like to eat?</div></div>
      <button className="avatar" aria-label="Profile"><Icon type="user" size={19}/></button>
    </header>
    <section className="hero">
      <div className="hero-copy"><strong>-40%</strong><span>on your</span><span>1<sup>st</sup> order</span></div>
      <img src="https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=800&q=85" alt="Fresh food"/>
    </section>
    <div className="cats" role="tablist">
      {categories.map(c=><button key={c} className={activeCat===c?'active':''} onClick={()=>setActiveCat(c)}>{c}</button>)}
    </div>
    <section className="suggestions">
      <div className="section-head"><h2>Our suggestions</h2><button>See all</button></div>
      <div className="grid">
       {visible.map(p=><article className="card" key={p.name}>
        <div className="photo"><img src={p.img} alt={p.name}/><button aria-label={liked.includes(p.name)?'Remove from favorites':'Add to favorites'} className={'heart '+(liked.includes(p.name)?'on':'')} onClick={()=>setLiked(x=>x.includes(p.name)?x.filter(n=>n!==p.name):[...x,p.name])}><Icon type="heart" size={17} filled={liked.includes(p.name)}/></button></div>
        <div className="pname">{p.name}</div>
        <div className="meta"><strong>{p.price}</strong><span><em>★</em> {p.rating}</span></div>
        <button className="add" aria-label={'Add '+p.name+' to orders'} onClick={()=>setCart(c=>c+1)}><Icon type="plus" size={14}/></button>
       </article>)}
      </div>
    </section>
   </div>
   <nav className="bottom">
    {nav.map(([label,icon])=><button key={label} className={tab===label?'selected':''} onClick={()=>setTab(label)}>
      <span className="navicon"><Icon type={icon} size={21} filled={tab===label&&icon==='heart'}/>{label==='Orders'&&cart>0&&<small>{cart}</small>}</span><span>{label}</span>
    </button>)}
   </nav>
  </main>
 </div>
}
createRoot(document.getElementById('root')).render(<App/>);