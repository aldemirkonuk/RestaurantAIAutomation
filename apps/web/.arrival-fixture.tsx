import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from './src/contexts/AuthContext';
import Arrival from './src/pages/arrival/Arrival';
import { arrivalApi, Book } from './src/pages/arrival/arrival-api';
import { documentsApi } from './src/services/api/documents';
import './src/styles/globals.css';
const source = <T,>(data: T) => ({ readable: true, data, reason: null })
function fixture(): Book {
  return {
    restaurantId: 'house',
    canManage: true,
    house: source({
      name: 'The fixture house',
      default_threshold_min: 3,
      threshold_configured: false,
    }),
    currency: source({
      code: 'TRY',
      readable: true,
      country: 'TR',
      reason: null,
      statedAt: null,
    }),
    cellar: source({
      registers: [
        {
          id: 'wines',
          carried: null,
          decidedBy: 'unknown',
          basis: 'No house evidence yet',
          evidence: { inventoryRows: 0, menuRows: 0 },
        },
      ],
      sources: {
        answers: { readable: true },
        inventory: { readable: true },
        menu: { readable: true },
      },
    }),
    vendors: source({
      terms: {
        vendors: [],
        sources: {
          providers: { readable: true },
          statedTerms: { readable: true },
        },
      },
      currencies: [],
    }),
    preferences: source({
      email: true,
      push: true,
      sms: false,
      categories: { inventory: true },
      quietHours: { enabled: false, startTime: '22:00', endTime: '08:00' },
      updatedAt: null,
    }),
    folios: source([]),
    batches: source([]),
    openingMenu: source({ menuId: null, items: [] }),
  }
}

const state = new URLSearchParams(location.search).get('state') || 'ready';
const ground = new URLSearchParams(location.search).get('ground') || 'charcoal';
const data = fixture();
const cell=(value:unknown)=>({value, source:'unknown'});
data.vendors.data!.terms.vendors=[{providerId:'vendor-fixture',providerName:'Bosphorus Beverage House',deliveryWeekdays:cell(null),leadTimeDays:cell(null),minimumOrder:cell(null),orderCutoff:cell(null),paymentTerms:cell(null),notes:null}];
data.vendors.data!.currencies=[{id:'vendor-fixture',name:'Bosphorus Beverage House',usual_currency:null}];
data.cellar.data!.registers.push({id:'beer',carried:false,decidedBy:'manual',basis:'Typed by you',evidence:{inventoryRows:0,menuRows:0}});
data.batches.data=[{id:'33333333-3333-4333-8333-333333333333',revision:0,status:'draft',sealed_at:null,undo_until:null,rows:[{id:'row-1',target:'vendor_currency',subjectId:'vendor-fixture',field:'code',value:'TRY',before:null,beforeValue:null,provenance:'invoice',status:'pending',reason:null},{id:'row-2',target:'cellar',field:'wines',value:true,before:null,beforeValue:null,provenance:'inferred',status:'pending',reason:null}]}];
if(state==='empty') {data.vendors.data!.terms.vendors=[];data.batches.data=[];}
if(state==='partial') data.vendors.data!.terms.sources.statedTerms.readable=false;
const prev=localStorage.getItem('activeRestaurantId');localStorage.setItem('activeRestaurantId','house');
window.addEventListener('pagehide',()=>prev===null?localStorage.removeItem('activeRestaurantId'):localStorage.setItem('activeRestaurantId',prev));
arrivalApi.read=async()=>{if(state==='error')throw Error('Fixture read unavailable');if(state==='loading')return new Promise(()=>{});return structuredClone(data)};
arrivalApi.skip=async(folio)=>{data.folios.data!.push({folio,state:'skipped',actor_id:'person',updated_at:new Date().toISOString()});return {recorded:true}};
arrivalApi.typed=async()=>({written:true,recorded:true,reason:null});
arrivalApi.propose=async()=>data.batches.data![0];
arrivalApi.apply=async()=>{throw Error('Fixture writer deliberately refuses: read the receipt.')};
arrivalApi.discard=async(_,rowId)=>{data.batches.data![0].rows=data.batches.data![0].rows.filter(r=>r.id!==rowId);return data.batches.data![0]};
arrivalApi.undo=async()=>{throw Error('Fixture undo conflict: a newer decision was retained.')};
documentsApi.list=async()=>[];
const query=new QueryClient({defaultOptions:{queries:{retry:false}}});
const observer=new MutationObserver(()=>{const el=document.querySelector<HTMLElement>('.ar-page');if(el&&el.dataset.ground!==ground)el.dataset.ground=ground;});observer.observe(document.documentElement,{childList:true,subtree:true});
createRoot(document.getElementById('root')!).render(<AuthContext.Provider value={{user:{userId:'person',name:'The keeper',role:'owner',restaurantId:'house'}} as any}><QueryClientProvider client={query}><MemoryRouter initialEntries={['/get-started']}><Arrival/></MemoryRouter></QueryClientProvider></AuthContext.Provider>);
