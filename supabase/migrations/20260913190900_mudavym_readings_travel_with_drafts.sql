-- A server-only provenance marker. Not accepted on a client order DTO.
alter table public.procurement_orders
  add column ask_reading_folio_id uuid,
  add constraint procurement_orders_reading_house_fk
    foreign key (ask_reading_folio_id, restaurant_id)
    references public.ask_reading_folios(id, restaurant_id);
create index procurement_orders_ask_reading on public.procurement_orders (ask_reading_folio_id)
  where ask_reading_folio_id is not null;
comment on column public.procurement_orders.ask_reading_folio_id is
  'Reading accepted when a Mudavym proposal became a draft. Before approval or sending its drafted letter, re-run it and bind its folio ID and measured fingerprint into the existing procurement_order seal. Changed evidence requires fresh review; never an assistant purchase seal.';
