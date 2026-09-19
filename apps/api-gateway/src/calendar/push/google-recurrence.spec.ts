import { googleRecurrence } from './google-recurrence';
const parent = { id:'p',restaurant_id:'r',start_date:'2026-09-03',is_recurring:true,recurrence_rule_id:'rule',all_day:true };
const rule = { id:'rule',restaurant_id:'r',calendar_event_id:'p',frequency:'weekly',interval_value:2,days_of_week:[1],end_type:'after_count',end_after_count:5 };
it('starts on the first actual occurrence, preserving weekly interval and count', () => {
 expect(googleRecurrence(parent,rule,[],[],null)).toEqual({ firstDate:'2026-09-14',lines:['RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=SU;BYDAY=MO;COUNT=5'] });
});
it('excludes changed/deleted/materialized occurrences from the template', () => {
 const child = { ...parent,id:'child',start_date:'2026-09-29',parent_event_id:'p',occurrence_date:'2026-09-28',is_recurring:false,recurrence_rule_id:null };
 const ex = [{ recurrence_rule_id:'rule', original_date:'2026-09-28',exception_type:'modified',replacement_event_id:'child' },{recurrence_rule_id:'rule',original_date:'2026-10-12',exception_type:'deleted'}];
 expect(googleRecurrence(parent,rule,ex,[child],null).lines).toContain('EXDATE;VALUE=DATE:20260928,20261012');
});
it('uses date UNTIL for all-day repeats and UTC UNTIL for timed ones', () => {
 const until = {...rule,end_type:'on_date',end_on_date:'2026-10-31'};
 expect(googleRecurrence(parent,until,[],[],null).lines[0]).toContain('UNTIL=20261031');
 expect(googleRecurrence({...parent,all_day:false,start_time:'09:00'},until,[],[],'Europe/Istanbul').lines[0]).toContain('UNTIL=20261031T205900Z');
});
it('refuses custom rules and timed exceptions without a house zone', () => {
 expect(()=>googleRecurrence(parent,{...rule,frequency:'custom'},[],[],null)).toThrow('cannot be expanded');
 expect(()=>googleRecurrence({...parent,all_day:false,start_time:'09:00'},rule,[{recurrence_rule_id:'rule',original_date:'2026-09-14',exception_type:'deleted'}],[],null)).toThrow('timezone');
});
