import { CalendarService } from './calendar.service';
import { fakeSupabase } from './push/fake-supabase';
function harness(initial: Record<string, Record<string, unknown>[]>) {
 const store = fakeSupabase(initial);
 const service = new CalendarService({ supabase: store.client } as any, { createEvent: jest.fn() } as any, { push: jest.fn() } as any);
 return { store, service };
}
it('reads all pages before resolving a window and excludes other houses', async () => {
 const events = Array.from({ length: 1_105 }, (_, i) => ({ id: String(i).padStart(5,'0'), restaurant_id: 'house', start_date: '2026-09-13', title: `Event ${i}`, is_recurring: false }));
 const { service } = harness({ calendar_events: [...events, { id:'foreign', restaurant_id:'other', start_date:'2026-09-13' }] });
 const result = await service.listEvents('house', { startDate:'2026-09-01',endDate:'2026-09-30',page:3,limit:500 });
 expect(result.total).toBe(1105); expect(result.events).toHaveLength(105); expect(result.hasMore).toBe(false);
 expect(result.events.every((event) => event.occurrenceResolved)).toBe(true);
});
it('reads old parents and their owned exceptions instead of filtering their start date away', async () => {
 const { service } = harness({ calendar_events:[{ id:'parent',restaurant_id:'house',start_date:'2020-01-06',is_recurring:true,recurrence_rule_id:'rule',title:'Weekly',event_type:'delivery' }], calendar_recurrence_rules:[{ id:'rule',restaurant_id:'house',calendar_event_id:'parent',frequency:'weekly',interval_value:1,days_of_week:[1],end_type:'never' }], calendar_recurrence_exceptions:[{ id:'skip',recurrence_rule_id:'rule',original_date:'2026-09-14',exception_type:'deleted' },{ id:'foreign',recurrence_rule_id:'foreign-rule',original_date:'2026-09-21',exception_type:'deleted' }] });
 const result = await service.listEvents('house', { startDate:'2026-09-01',endDate:'2026-09-30' });
 expect(result.events.map((event) => event.eventDate)).toEqual(['2026-09-07','2026-09-21','2026-09-28']);
 expect(result.events.every((event) => event.parentEventId === 'parent')).toBe(true);
});
it('refuses unknown repeats instead of returning an empty calendar', async () => {
 const { service } = harness({ calendar_events:[{id:'p',restaurant_id:'house',start_date:'2020-01-01',is_recurring:true}] });
 await expect(service.listEvents('house',{startDate:'2026-09-01',endDate:'2026-09-30'})).rejects.toThrow('exactly one readable repeat rule');
});
it('never invokes the service-role generation RPC for another house or an unreadable rule', async () => {
 const rpc = jest.fn(); const eq = jest.fn().mockReturnThis();
 const db = { from:jest.fn().mockReturnThis(),select:jest.fn().mockReturnThis(),eq,single:jest.fn().mockResolvedValue({data:null,error:null}),rpc };
 const service = new CalendarService({supabase:db} as any,{} as any,{} as any);
 await expect(service.generateOccurrences('house','foreign-rule')).rejects.toThrow('not found');
 expect(eq).toHaveBeenCalledWith('restaurant_id','house'); expect(rpc).not.toHaveBeenCalled();
 db.single.mockResolvedValueOnce({data:null,error:{message:'offline'}});
 await expect(service.generateOccurrences('house','rule')).rejects.toThrow('not found'); expect(rpc).not.toHaveBeenCalled();
});
