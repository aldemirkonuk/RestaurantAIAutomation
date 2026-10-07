-- ADR 0301, the founder's ruling of 2026-10-05 ("Join by contained name,
-- split Sold"): Tuzlu Rüzgar's till adds a serve size to the menu's name
-- ('Yeni Rakı (single 50ml)', 'Efes Pilsen (draft 400ml)'), and
-- house_beverage_ledger joined a till name to a row only when their
-- beverage_house_keys were equal, so those lines reached no Sold or Taken.
-- Migration a_till_name_with_a_serve_size_joins_its_row joins each till name
-- to the most specific row whose words it holds (an exact key wins; a tie
-- joins none), and splits Sold into bottles, glasses and unknown unit by each
-- line's sale unit, in ADR 0011's order.
--
-- [ADDED 2026-10-06, the founder's answers to the PR's forks (ADR 0301):
-- F1 "Also match without maker": a name that holds no row's full words tries
-- each menu or order row's name without its maker, by the same rules (S10,
-- S11); F2 "List tied names on the row": each tied row lists the names that
-- tied (S3, S8, S12); F5 "Keep one rule": a catalogue-only row's record has no
-- till lines (S13). On the branch's build before them (a5879b72d), S10 and
-- S11 fail on what they count (the bare names join nothing there), S12 on
-- the tied_names column, S8 on the tied names, which that build does not
-- list, and S9 on the column count. S3 passes there: the tie refusal it pins
-- predates them. S13 passes there too, as F5 changes nothing: it reads
-- tied_names through to_jsonb(l) so it runs on both builds.]
--
-- [ADDED 2026-10-07, the founder's answers of 2026-10-06 to the #650 BLOCK
-- (ADR 0301): "Menu first": an invoice, order or quote row takes only a till
-- name that no menu row contains (S14, S15, S18); size words "Only to break
-- ties": rows rank by product words, and size words decide only between
-- rows level on those (S16, S17). Each names the mutation that kills it; all
-- were run on a local database (fixes/audits/650-local-pg.txt). On the build
-- before them (3f3689307) S14, S15, S17 and S18 fail; S16 passes there, as
-- counting size words as any word also picks the 35cl row.]
--
-- [ADDED 2026-10-07, the audit of aa5b5ce19: five one-spot mutations of the
-- migration passed every block above. Each now has a block that kills it:
-- the bare pass's size words forced to 0 (S19), the order book's rows read
-- as menu rows (S20, S21), passes 3 and 4 read as one (S21), the bare
-- names' size words counted as product words (S22), and size words read
-- from menu labels only (S23). On 3f3689307 S20, S22 and S23 fail too; S19
-- and S21 pass there, as that build picks the same rows by other rules.]
--
-- [ADDED 2026-10-07, the verifier's last items on this branch: S19 pins the
-- bare pass's size tie-break on menu rows (pass 2) only. S24 to S27 pin pass
-- 4, order rows by their name without the maker: its size tie-break (S24),
-- a product word beating a size (S25), an exact name winning outright (S26)
-- and a tie joining neither row (S27). Each fails on a one-spot mutation of
-- the migration scoped to pass 4 (named in its block), and each of those
-- mutations fails that block alone of the 27
-- (fixes/audits/650-local-pg-b31ee7f33-pass4.txt). On 3f3689307 S25 fails,
-- as the 70cl row's five words beat the Ala's four there; S24, S26 and S27
-- pass there, as that build picks the same rows by other rules.]
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or the
-- error itself), so `psql -v ON_ERROR_STOP=1 -f` stops at the first one. Run
-- it on a database built from supabase/migrations. Synthetic fixtures only,
-- one transaction, rolled back: it leaves nothing behind. Every product name
-- starts with "Zqss", so rows already in a populated database cannot match.
-- [CHANGED 2026-10-07: every product and maker name starts with a word
-- beginning "Zq" (Zqss, Zqef, Zqrd, Zqyk, Zqpr, Zqmk, Zqyr, Zqmf, Zqtb, Zqaw,
-- Zqbp, Zqob), not only "Zqss", since F1 of 2026-10-06.]
-- [CHANGED 2026-10-07, the audit of aa5b5ce19: S19 to S23 add Zqbs, Zqot,
-- Zqfp, Zqbw and Zqiv.]
-- [CHANGED 2026-10-07, the verifier's last items: S24 to S27 add Zqos,
-- Zqow, Zqoe and Zqoy.]
--
-- On a build WITHOUT the migration (#627's head, 27faf423a), every block
-- fails. S2, S4 and S5 fail on what they count: the names they join reach no
-- row there. S1's and S3's counts hold on that build too, since it joined
-- equal keys only and so never joined either case; they fail there on what
-- they add (house_till_names(uuid, text), tied_lines), and they pin that the
-- looser rule did not loosen them. S6 to S9 fail because the columns and the
-- function they read do not exist on that build.

begin;

insert into public.restaurants (id, name, slug) values
  ('a3030000-0000-4000-8000-000000000001', 'Servesize house', 'servesize-house'),
  ('a3030000-0000-4000-8000-000000000002', 'Servesize other house', 'servesize-other-house');

insert into public.restaurant_menus (id, restaurant_id, name, status) values
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Current', 'active');

insert into public.menu_items (menu_id, restaurant_id, name, producer, category, bottle_price, status) values
  -- S1: two rows with the same three words. 'Zqss Efes' + 'Efes Pilsen' keys
  -- 'efes efes pilsen zqss'; 'Zqss Efes Pilsen' keys 'efes pilsen zqss'.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Efes Pilsen', 'Zqss Efes', 'Beer', 8, 'approved'),
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqss Efes Pilsen', null, 'Beer', 8, 'approved'),
  -- S2: a row and a more specific one.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqss Yeni Raki', null, 'Rakı', 90, 'approved'),
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqss Yeni Raki Ala', null, 'Rakı', 120, 'approved'),
  -- S3: two rows a till name can hold equally.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqss Lal Rose', null, 'Wine', 40, 'approved'),
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqss Lal Kavak', null, 'Wine', 40, 'approved'),
  -- S4: a spirit with a row, and a cocktail named after it with none.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqss Fords Gin', null, 'Spirits', 70, 'approved'),
  -- S5: a draft beer the till rings with its serve size and no inventory item.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqss Reality Czeck', null, 'Beer', 9, 'approved'),
  -- S6: the wine whose lines exercise every unit rule.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqss Suvla Sur', null, 'Wine', 45, 'approved'),
  -- S10 (F1): a menu that carries producers, the shape of the sim's house A
  -- ('Anadolu Efes' + 'Efes Pilsen'). The pilsner and the more specific malt
  -- key with their maker; the till rings their names alone.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqef Pilsner', 'Zqmk Anadolu Zqef', 'Beer', 9, 'approved'),
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqef Pilsner Malt', 'Zqmk Anadolu Zqef', 'Beer', 10, 'approved'),
  -- S10: two makers' rows whose bare names have the same two words; one's is
  -- the till name's key exactly, so it wins outright, as S1's exact key does.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqrd Rouge', 'Zqmk Kavak', 'Wine', 40, 'approved'),
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqrd Zqrd Rouge', 'Zqmk Other', 'Wine', 40, 'approved'),
  -- S11 (F1): two makers' rows with the same bare name: a tie.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqyk Yakut', 'Zqmk Doluca', 'Wine', 40, 'approved'),
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqyk Yakut', 'Zqmk Kavaklidere', 'Wine', 40, 'approved'),
  -- S11: a row with no maker whose full words a till name holds, and a more
  -- specific row that only its bare name reaches.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqpr Gold', null, 'Rakı', 80, 'approved'),
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqpr Gold Seri', 'Zqmk Tekirdag', 'Rakı', 95, 'approved');

-- Inventory: the rakı (a 700 ml bottle, no pour size), the wine (750 ml, a
-- 150 ml pour), an item with no sizes, and the other house's rakı.
insert into public.restaurant_inventory (id, restaurant_id, kind, uom, display_name, identity_provenance, bottle_size_ml, pour_size_ml) values
  ('a3030000-0000-4000-8000-0000000000f1', 'a3030000-0000-4000-8000-000000000001', 'spirit', 'bottle', 'Zqss Yeni Raki', 'house_declared', 700, null),
  ('a3030000-0000-4000-8000-0000000000f2', 'a3030000-0000-4000-8000-000000000001', 'wine', 'bottle', 'Zqss Suvla Sur', 'house_declared', 750, 150),
  ('a3030000-0000-4000-8000-0000000000f3', 'a3030000-0000-4000-8000-000000000001', 'wine', 'bottle', 'Zqss No Sizes', 'house_declared', null, null),
  ('a3030000-0000-4000-8000-0000000000f9', 'a3030000-0000-4000-8000-000000000002', 'spirit', 'bottle', 'Zqss Yeni Raki', 'house_declared', 700, null);

insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, closed_at, voided, items) values
  ('a3030000-0000-4000-8000-000000000001', 'simpos', 'zqss-c1',
   '2026-08-07 19:00+00', '2026-08-07 21:00+00', false,
   '[{"name": "Zqss Efes Pilsen", "qty": 2, "price": 8},
     {"name": "Zqss Yeni Raki", "qty": 2, "price": 90, "is_wine": true, "inventory_id": "a3030000-0000-4000-8000-0000000000f1", "sale_unit": "bottle"},
     {"name": "Zqss Yeni Raki (single 50ml)", "qty": 4, "price": 14, "is_wine": true, "inventory_id": "a3030000-0000-4000-8000-0000000000f1", "sale_unit": "glass", "sale_volume_ml": 50},
     {"name": "Zqss Yeni Raki 70cl bottle", "qty": 1, "price": 80, "is_wine": true, "inventory_id": "a3030000-0000-4000-8000-0000000000f1", "sale_volume_ml": 700},
     {"name": "Zqss Yeni Raki (single 50ml)", "qty": 3, "price": 14, "is_wine": true, "inventory_id": "a3030000-0000-4000-8000-0000000000f9", "sale_unit": "glass", "sale_volume_ml": 50},
     {"name": "Zqss Yeni Raki Ala (single 50ml)", "qty": 2, "price": 16, "is_wine": true, "inventory_id": "a3030000-0000-4000-8000-0000000000f1", "sale_volume_ml": 50},
     {"name": "Zqss Lal Rose Kavak (glass)", "qty": 1, "price": 12},
     {"name": "Zqss Fords Gin (50ml)", "qty": 1, "price": 12},
     {"name": "Zqss Fords Gin Fizz", "qty": 2, "price": 15},
     {"name": "Zqss Reality Czeck (draft 400ml)", "qty": 3, "price": 10}]'::jsonb),
  -- S10 to S13: the producer-shaped menu's names, its ties, and a name no
  -- book's row holds.
  ('a3030000-0000-4000-8000-000000000001', 'simpos', 'zqss-c3',
   '2026-08-09 19:00+00', '2026-08-09 21:00+00', false,
   '[{"name": "Zqef Pilsner (draft 400ml)", "qty": 4, "price": 10},
     {"name": "Zqef Pilsner", "qty": 2, "price": 9},
     {"name": "Zqef Pilsner Malt (draft 500ml)", "qty": 1, "price": 11},
     {"name": "Zqrd Rouge", "qty": 1, "price": 40},
     {"name": "Zqyk Yakut (glass)", "qty": 2, "price": 12},
     {"name": "Zqyk Yakut (glass)", "qty": 1, "price": 12},
     {"name": "Zqpr Gold Seri (single 50ml)", "qty": 2, "price": 15},
     {"name": "Zqss Kalecik Karasi (glass)", "qty": 1, "price": 11}]'::jsonb),
  -- S6: every unit rule, on the wine's row. Sold 5+1+1+2+1+2+1+1+1+1+1 = 17.
  ('a3030000-0000-4000-8000-000000000001', 'simpos', 'zqss-c2',
   '2026-08-08 19:00+00', '2026-08-08 21:00+00', false,
   '[{"name": "Zqss Suvla Sur (glass)", "qty": 5, "price": 11, "inventory_id": "a3030000-0000-4000-8000-0000000000f2", "sale_unit": "glass"},
     {"name": "Zqss Suvla Sur (glass)", "qty": 1, "price": 11, "inventory_id": "a3030000-0000-4000-8000-0000000000f3", "sale_unit": "glass"},
     {"name": "Zqss Suvla Sur magnum", "qty": 1, "price": 90, "inventory_id": "a3030000-0000-4000-8000-0000000000f2", "sale_volume_ml": 1500},
     {"name": "Zqss Suvla Sur taste", "qty": 2, "price": 0, "inventory_id": "a3030000-0000-4000-8000-0000000000f2", "sale_volume_ml": 5},
     {"name": "Zqss Suvla Sur (bottle)", "qty": 1, "price": 11, "inventory_id": "a3030000-0000-4000-8000-0000000000f2", "sale_unit": "bottle", "sale_volume_ml": 150},
     {"name": "Zqss Suvla Sur (bottle)", "qty": 2, "price": 45, "inventory_id": "a3030000-0000-4000-8000-0000000000f3", "sale_unit": " BOTTLE "},
     {"name": "Zqss Suvla Sur (bottle)", "qty": 1, "price": 45, "inventory_id": "a3030000-0000-4000-8000-0000000000f2", "sale_volume_ml": "750"},
     {"name": "Zqss Suvla Sur carafe", "qty": 1, "price": 30, "inventory_id": "a3030000-0000-4000-8000-0000000000f3", "sale_volume_ml": 600},
     {"name": "Zqss Suvla Sur carafe", "qty": 1, "price": 30, "inventory_id": "a3030000-0000-4000-8000-0000000000f2", "sale_volume_ml": "abc"},
     {"name": "Zqss Suvla Sur (bottle)", "qty": 1, "price": 45, "inventory_id": "not-a-uuid", "sale_unit": "bottle"},
     {"name": "Zqss Suvla Sur (bottle)", "qty": 1, "price": 45, "inventory_id": "A3030000-0000-4000-8000-0000000000F2", "sale_unit": "bottle"}]'::jsonb);

insert into public.pos_unresolved_lines
  (restaurant_id, source, external_check_id, external_item_id, item_name, qty, price, resolved, created_at) values
  -- S3: an orphan queue line whose name ties too. The queue held it, so it is
  -- a row of its own, as a till name that joins no row always was.
  ('a3030000-0000-4000-8000-000000000001', 'toast', 'zqss-orphan', 'm1', 'Zqss Lal Rose Kavak Magnum', 1, 90, false, '2026-08-09 20:00+00');

-- [ADDED 2026-10-07, the founder's answers of 2026-10-06 to the #650 BLOCK
-- (ADR 0301): "Menu first" and size words "Only to break ties". S14 to S18.]
insert into public.menu_items (menu_id, restaurant_id, name, producer, category, bottle_price, status) values
  -- S14: the BLOCK's case, a menu row and (below) a quote whose only extra
  -- words are a size.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqyr Yeni Rakı Âlâ', null, 'Rakı', 120, 'approved'),
  -- S15: a menu row, and (below) two invoice rows that each hold its words
  -- and more: a size, and a product word.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqmf Tekel Raki', null, 'Rakı', 90, 'approved'),
  -- S16: two menu rows level on product words; one names a size.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqtb Yeni Raki', null, 'Rakı', 90, 'approved'),
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqtb Yeni Raki 35cl', null, 'Rakı', 50, 'approved'),
  -- S17: two menu rows, one with a product word more, one with a size.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqaw Yeni Raki Ala', null, 'Rakı', 120, 'approved'),
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqaw Yeni Raki 70cl', null, 'Rakı', 90, 'approved'),
  -- S18: a menu line that names its maker, and (below) a quote of its bare name.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqbp Pilsen', 'Zqmk Anadolu', 'Beer', 9, 'approved');

insert into public.vendor_price_observations (restaurant_id, product_name_raw, source_type, trust_tier, raw_price, observed_at) values
  ('a3030000-0000-4000-8000-000000000001', 'Zqyr Yeni Rakı 70cl', 'quote', 3, 70, '2026-08-01 10:00+00'),
  ('a3030000-0000-4000-8000-000000000001', 'Zqbp Pilsen', 'quote', 3, 5, '2026-08-01 10:00+00');

insert into public.procurement_documents (id, restaurant_id, doc_type, source_channel, doc_date) values
  ('a3030000-0000-4000-8000-0000000000d1', 'a3030000-0000-4000-8000-000000000001', 'invoice', 'manual', '2026-08-02');
insert into public.procurement_document_lines (document_id, restaurant_id, line_no, description, qty_bottles, unit_price) values
  ('a3030000-0000-4000-8000-0000000000d1', 'a3030000-0000-4000-8000-000000000001', 1, 'Zqmf Tekel Raki 70cl', 6, 60),
  ('a3030000-0000-4000-8000-0000000000d1', 'a3030000-0000-4000-8000-000000000001', 2, 'Zqmf Tekel Raki Ozel', 6, 80);

-- S18: an order line that names its maker, and no other book's row its till
-- name holds.
insert into public.providers (id, name, primary_contact) values
  ('a3030000-0000-4000-8000-0000000000e1', 'Zqss Supplier', '{}'::jsonb);
insert into public.procurement_orders (id, order_number, restaurant_id, inventory_id, provider_id, quantity, bottles_total, final_price, total_cost, requested_at) values
  ('a3030000-0000-4000-8000-0000000000e2', 'ZQSS-1', 'a3030000-0000-4000-8000-000000000001', 'a3030000-0000-4000-8000-0000000000f1', 'a3030000-0000-4000-8000-0000000000e1', 1, 1, 10, 10, '2026-08-03 10:00+00');
insert into public.procurement_order_items (order_id, wine_name, producer, quantity) values
  ('a3030000-0000-4000-8000-0000000000e2', 'Zqob Lager', 'Zqmk Brewer', 1);

insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, closed_at, voided, items) values
  ('a3030000-0000-4000-8000-000000000001', 'simpos', 'zqss-c4',
   '2026-08-10 19:00+00', '2026-08-10 21:00+00', false,
   '[{"name": "Zqyr Yeni Rakı Âlâ 70cl bottle", "qty": 3, "price": 100},
     {"name": "Zqyr Yeni Rakı Âlâ (single 50ml)", "qty": 2, "price": 15},
     {"name": "Zqyr Yeni Rakı 70cl", "qty": 1, "price": 80},
     {"name": "Zqmf Tekel Raki 70cl bottle", "qty": 2, "price": 90},
     {"name": "Zqmf Tekel Raki Ozel 70cl", "qty": 1, "price": 110},
     {"name": "Zqmf Tekel Raki 70cl", "qty": 4, "price": 85},
     {"name": "Zqtb Yeni Raki 35cl (glass)", "qty": 2, "price": 50},
     {"name": "Zqtb Yeni Raki (single 50ml)", "qty": 3, "price": 14},
     {"name": "Zqaw Yeni Raki Ala 70cl bottle", "qty": 1, "price": 120},
     {"name": "Zqbp Pilsen (draft 400ml)", "qty": 4, "price": 9},
     {"name": "Zqob Lager (draft 400ml)", "qty": 2, "price": 8}]'::jsonb);

-- [ADDED 2026-10-07, the audit of aa5b5ce19: the one-spot mutations of the
-- migration that S1 to S18 let pass. S19 to S23.]
insert into public.menu_items (menu_id, restaurant_id, name, producer, category, bottle_price, status) values
  -- S19: three rows of one maker, level on product words without it; two
  -- name a size.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqbs Yeni Raki', 'Zqmk Tekel', 'Rakı', 90, 'approved'),
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqbs Yeni Raki 35cl', 'Zqmk Tekel', 'Rakı', 50, 'approved'),
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqbs Yeni Raki 70cl', 'Zqmk Tekel', 'Rakı', 80, 'approved'),
  -- S20: a menu row, and (below) an order line with a product word more.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqot Raki', null, 'Rakı', 90, 'approved'),
  -- S22: two rows of one maker: one with a product word more, one with a size.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqbw Yeni Raki Ala', 'Zqmk Efendi', 'Rakı', 120, 'approved'),
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqbw Yeni Raki 70cl', 'Zqmk Efendi', 'Rakı', 90, 'approved');

-- S21: a quote no menu row holds, and (below) an order line that names its
-- maker.
insert into public.vendor_price_observations (restaurant_id, product_name_raw, source_type, trust_tier, raw_price, observed_at) values
  ('a3030000-0000-4000-8000-000000000001', 'Zqfp Lager', 'quote', 3, 4, '2026-08-01 10:00+00');

-- S20 and S21: two more lines on the order above.
insert into public.procurement_order_items (order_id, wine_name, producer, quantity) values
  ('a3030000-0000-4000-8000-0000000000e2', 'Zqot Raki Ozel', null, 1),
  ('a3030000-0000-4000-8000-0000000000e2', 'Zqfp Lager Gold', 'Zqmk Brauhaus', 1);

-- S23: two invoice rows no menu row holds: one with a product word more, one
-- with a size.
insert into public.procurement_document_lines (document_id, restaurant_id, line_no, description, qty_bottles, unit_price) values
  ('a3030000-0000-4000-8000-0000000000d1', 'a3030000-0000-4000-8000-000000000001', 3, 'Zqiv Raki Ozel', 6, 80),
  ('a3030000-0000-4000-8000-0000000000d1', 'a3030000-0000-4000-8000-000000000001', 4, 'Zqiv Raki 70cl', 6, 60);

insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, closed_at, voided, items) values
  ('a3030000-0000-4000-8000-000000000001', 'simpos', 'zqss-c5',
   '2026-08-11 19:00+00', '2026-08-11 21:00+00', false,
   '[{"name": "Zqbs Yeni Raki 35cl (glass)", "qty": 2, "price": 50},
     {"name": "Zqbs Yeni Raki 70cl bottle", "qty": 1, "price": 80},
     {"name": "Zqot Raki Ozel 70cl", "qty": 2, "price": 95},
     {"name": "Zqfp Lager Gold (draft 400ml)", "qty": 3, "price": 8},
     {"name": "Zqbw Yeni Raki Ala 70cl bottle", "qty": 1, "price": 120},
     {"name": "Zqiv Raki Ozel 70cl", "qty": 1, "price": 85}]'::jsonb);

-- [ADDED 2026-10-07, the verifier of b31ee7f33: S19 pins the bare pass's
-- size tie-break on menu rows (pass 2) only. S24 to S27 pin pass 4, order
-- rows by their name without the maker: two order rows per block, of one
-- maker or two, that no menu row and no supplier row's full words reach.]
insert into public.procurement_order_items (order_id, wine_name, producer, quantity) values
  -- S24: level on product words without the maker; one names a size.
  ('a3030000-0000-4000-8000-0000000000e2', 'Zqos Yeni Raki', 'Zqmk Imbik', 1),
  ('a3030000-0000-4000-8000-0000000000e2', 'Zqos Yeni Raki 35cl', 'Zqmk Imbik', 1),
  -- S25: one with a product word more, one with a size.
  ('a3030000-0000-4000-8000-0000000000e2', 'Zqow Yeni Raki Ala', 'Zqmk Kazan', 1),
  ('a3030000-0000-4000-8000-0000000000e2', 'Zqow Yeni Raki 70cl', 'Zqmk Kazan', 1),
  -- S26: two makers' rows level in words; one's name without its maker is
  -- the till name's key.
  ('a3030000-0000-4000-8000-0000000000e2', 'Zqoe Rouge', 'Zqmk Bagci', 1),
  ('a3030000-0000-4000-8000-0000000000e2', 'Zqoe Zqoe Rouge', 'Zqmk Diger', 1),
  -- S27: two makers' rows with the same name without the maker.
  ('a3030000-0000-4000-8000-0000000000e2', 'Zqoy Yakut', 'Zqmk Sarap', 1),
  ('a3030000-0000-4000-8000-0000000000e2', 'Zqoy Yakut', 'Zqmk Asma', 1);

insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, closed_at, voided, items) values
  ('a3030000-0000-4000-8000-000000000001', 'simpos', 'zqss-c6',
   '2026-08-12 19:00+00', '2026-08-12 21:00+00', false,
   '[{"name": "Zqos Yeni Raki 35cl (glass)", "qty": 2, "price": 50},
     {"name": "Zqow Yeni Raki Ala 70cl bottle", "qty": 1, "price": 120},
     {"name": "Zqoe Rouge", "qty": 1, "price": 40},
     {"name": "Zqoy Yakut (glass)", "qty": 2, "price": 12}]'::jsonb);

create function pg_temp.ss_row(p_label text)
returns table (pos_lines integer, poured_qty numeric, poured_revenue numeric)
language sql as $$
  select l.pos_lines, l.poured_qty, l.poured_revenue
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = p_label
$$;

-- S1 an exact key wins over a row the name merely holds. 'Zqss Efes Pilsen'
-- holds every word of both rows, and both have three; its key is the second
-- row's, so it joins that one, and the first gets nothing: not its lines, and
-- not a tie either, since an exact key wins outright rather than drawing
-- level with a row of the same words.
do $$
declare r record; got text; n integer;
begin
  select * into r from pg_temp.ss_row('Zqss Efes Pilsen');
  assert r.pos_lines = 1 and r.poured_qty = 2,
    format('S1 FAIL ''Zqss Efes Pilsen'' reads pos_lines %s, Sold %s; expected 1 and 2 (its exact name)', r.pos_lines, r.poured_qty);
  select * into r from pg_temp.ss_row('Zqss Efes Efes Pilsen');
  assert r.pos_lines = 0, format('S1 FAIL the producer-and-name row reads pos_lines %s; expected 0 (the exact row won)', r.pos_lines);
  select l.tied_lines into n from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqss Efes Efes Pilsen';
  assert n = 0, format('S1 FAIL the producer-and-name row reads tied_lines %s; expected 0 (an exact key ties with nothing)', n);
  select string_agg(t.item_name || '=' || t.joined_by, ', ') into got
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'Zqss Efes Pilsen') t;
  assert got = 'Zqss Efes Pilsen=exact', format('S1 FAIL the exact row''s record lists %s', got);
  select count(*) into n
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'Zqss Efes Efes Pilsen') t;
  assert n = 0, format('S1 FAIL the producer-and-name row''s record lists %s names; expected 0', n);
end $$;

-- S2 the most specific row wins. 'Zqss Yeni Raki Ala (single 50ml)' holds the
-- words of both rakı rows and joins the one with more; the plain rakı's sized
-- names join the plain rakı.
do $$
declare r record;
begin
  select * into r from pg_temp.ss_row('Zqss Yeni Raki Ala');
  assert r.pos_lines = 1 and r.poured_qty = 2,
    format('S2 FAIL the Ala reads pos_lines %s, Sold %s; expected 1 and 2', r.pos_lines, r.poured_qty);
  select * into r from pg_temp.ss_row('Zqss Yeni Raki');
  assert r.pos_lines = 4 and r.poured_qty = 10 and r.poured_revenue = 180 + 56 + 80 + 42,
    format('S2 FAIL the rakı reads pos_lines %s, Sold %s, Taken %s; expected 4, 10 and 358 (its own name and its two sized names, not the Ala''s)', r.pos_lines, r.poured_qty, r.poured_revenue);
end $$;

-- S3 a tie joins neither row. 'Zqss Lal Rose Kavak (glass)' holds both wines'
-- three words; neither's Sold counts it, and, never queued, it is no row of
-- its own. The queued orphan that ties the same way is a row of its own.
do $$
declare r record; n integer; a integer; b integer;
begin
  select * into r from pg_temp.ss_row('Zqss Lal Rose');
  assert r.pos_lines = 0, format('S3 FAIL the rosé reads pos_lines %s; expected 0 (the name tied)', r.pos_lines);
  select * into r from pg_temp.ss_row('Zqss Lal Kavak');
  assert r.pos_lines = 0, format('S3 FAIL the kavak reads pos_lines %s; expected 0 (the name tied)', r.pos_lines);
  select count(*) into n from pg_temp.ss_row('Zqss Lal Rose Kavak (glass)');
  assert n = 0, format('S3 FAIL the tied name reads as %s ledger rows of its own; expected 0 (the queue never held it)', n);
  select * into r from pg_temp.ss_row('Zqss Lal Rose Kavak Magnum');
  assert r.pos_lines = 1, format('S3 FAIL the queued tied name reads pos_lines %s; expected 1 (a row of its own)', r.pos_lines);
  -- The tie is counted where it shows: each tied row's tied_lines holds the
  -- lines of the names that tied on it (the glass, and the queued magnum).
  select l.tied_lines into a from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqss Lal Rose';
  select l.tied_lines into b from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqss Lal Kavak';
  assert a = 2 and b = 2, format('S3 FAIL the tied rows read tied_lines %s and %s; expected 2 and 2', a, b);
  select l.tied_lines into a from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqss Yeni Raki';
  assert a = 0, format('S3 FAIL the rakı reads tied_lines %s; expected 0', a);
end $$;

-- S12 (F2, 2026-10-06, "List tied names on the row") each tied row's ledger
-- row lists the till names that tied on it, with their lines, as 'tie'; the
-- lines still join neither row (S3). A row nothing tied on lists none.
do $$
declare got text; n integer;
begin
  select string_agg(j.item_name || '=' || j.how || ':' || j.lines, ', ' order by j.item_name collate "C")
    into got
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
    cross join lateral jsonb_to_recordset(l.tied_names) as j(item_name text, lines integer, how text)
   where l.label = 'Zqss Lal Rose';
  assert got = 'Zqss Lal Rose Kavak (glass)=tie:1, Zqss Lal Rose Kavak Magnum=tie:1',
    format('S12 FAIL the rosé lists tied names %s', got);
  select string_agg(j.item_name || '=' || j.how || ':' || j.lines, ', ' order by j.item_name collate "C")
    into got
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
    cross join lateral jsonb_to_recordset(l.tied_names) as j(item_name text, lines integer, how text)
   where l.label = 'Zqss Lal Kavak';
  assert got = 'Zqss Lal Rose Kavak (glass)=tie:1, Zqss Lal Rose Kavak Magnum=tie:1',
    format('S12 FAIL the kavak lists tied names %s', got);
  select count(*) into n
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqss Yeni Raki' and l.tied_names is not null;
  assert n = 0, format('S12 FAIL the rakı lists tied names; expected none');
  -- The tied names' lines are tied_lines, line for line.
  select count(*) into n
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.tied_lines <> coalesce((select sum((j->>'lines')::integer) from jsonb_array_elements(l.tied_names) j), 0);
  assert n = 0, format('S12 FAIL %s rows'' tied names do not sum to their tied_lines', n);
end $$;

-- S4 the ruling's stated risk, pinned: a cocktail named after a spirit, with
-- no row of its own, joins that spirit. 'Zqss Fords Gin Fizz' holds the
-- gin's three words, so the gin's Sold counts its 2 with the 50 ml single.
do $$
declare r record;
begin
  select * into r from pg_temp.ss_row('Zqss Fords Gin');
  assert r.pos_lines = 2 and r.poured_qty = 3 and r.poured_revenue = 12 + 30,
    format('S4 FAIL the gin reads pos_lines %s, Sold %s, Taken %s; expected 2, 3 and 42 (its single and the cocktail)', r.pos_lines, r.poured_qty, r.poured_revenue);
end $$;

-- S5 an unmapped draft with a serve size joins its row too: the till rang
-- 'Zqss Reality Czeck (draft 400ml)' with no inventory item, and it holds
-- every word of 'Zqss Reality Czeck'.
do $$
declare r record;
begin
  select * into r from pg_temp.ss_row('Zqss Reality Czeck');
  assert r.pos_lines = 1 and r.poured_qty = 3 and r.poured_revenue = 30,
    format('S5 FAIL the draft beer reads pos_lines %s, Sold %s, Taken %s; expected 1, 3 and 30', r.pos_lines, r.poured_qty, r.poured_revenue);
end $$;

-- S6 Sold splits by what one of each line is, in ADR 0011's order, and the
-- three parts sum to Sold. On the wine's row:
--   glass  : 5 (label glass, item pours 150) + 1 (volume 150 outranks the
--            label bottle) + 1 (volume 600, item with no bottle size: under
--            the 750 default)                                       =  7
--   bottle : 2 (label ' BOTTLE ', no sizes needed) + 1 (volume "750" equals
--            the item's bottle)                                      =  3
--   unknown: 1 (label glass, item has no pour size) + 1 (1500 over the
--            item's bottle) + 2 (5 ml, under 10) + 1 (volume not a number)
--            + 1 (inventory_id not a uuid) + 1 (inventory_id not as
--            Postgres writes the item's id, which the bridge cannot find
--            either)                                                 =  7
do $$
declare r record;
begin
  select l.pos_lines, l.poured_qty, l.poured_bottles, l.poured_glasses, l.poured_unit_unknown
    into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqss Suvla Sur';
  assert r.pos_lines = 11 and r.poured_qty = 17,
    format('S6 FAIL the wine reads pos_lines %s, Sold %s; expected 11 and 17', r.pos_lines, r.poured_qty);
  assert r.poured_glasses = 7, format('S6 FAIL the wine reads %s glasses, expected 7', r.poured_glasses);
  assert r.poured_bottles = 3, format('S6 FAIL the wine reads %s bottles, expected 3', r.poured_bottles);
  assert r.poured_unit_unknown = 7, format('S6 FAIL the wine reads %s of unknown unit, expected 7', r.poured_unit_unknown);
end $$;

-- S7 on the rakı: a label bottle (2) and a volume equal to the bottle (1) are
-- bottles; a 50 ml single on this house's item is a glass (4); the same
-- single on the other house's item is unknown (3), as the bridge books it
-- nowhere. Every line with no inventory item is unknown: the cocktail and the
-- draft. Across the house, bottles + glasses + unknown = Sold on every row.
do $$
declare r record; bad integer;
begin
  select l.poured_qty, l.poured_bottles, l.poured_glasses, l.poured_unit_unknown
    into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqss Yeni Raki';
  assert r.poured_bottles = 3 and r.poured_glasses = 4 and r.poured_unit_unknown = 3,
    format('S7 FAIL the rakı splits %s bottles, %s glasses, %s unknown; expected 3, 4 and 3', r.poured_bottles, r.poured_glasses, r.poured_unit_unknown);
  select l.poured_qty, l.poured_bottles, l.poured_glasses, l.poured_unit_unknown
    into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqss Fords Gin';
  assert r.poured_unit_unknown = 3 and r.poured_bottles = 0 and r.poured_glasses = 0,
    format('S7 FAIL the gin splits %s bottles, %s glasses, %s unknown; expected 0, 0 and 3 (no line names an item)', r.poured_bottles, r.poured_glasses, r.poured_unit_unknown);
  select l.poured_qty, l.poured_bottles, l.poured_glasses, l.poured_unit_unknown
    into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqss Reality Czeck';
  assert r.poured_unit_unknown = 3 and r.poured_bottles = 0 and r.poured_glasses = 0,
    format('S7 FAIL the draft splits %s bottles, %s glasses, %s unknown; expected 0, 0 and 3 (unmapped: no item)', r.poured_bottles, r.poured_glasses, r.poured_unit_unknown);
  select count(*) into bad
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.poured_qty is distinct from
         (l.poured_bottles + l.poured_glasses + l.poured_unit_unknown);
  assert bad = 0, format('S7 FAIL %s rows'' three parts do not sum to their Sold', bad);
  select count(*) into bad
    from public.house_till_lines('a3030000-0000-4000-8000-000000000001'::uuid) t
   where t.from_queue and t.sold_as is not null;
  assert bad = 0, format('S7 FAIL %s queue lines have a unit; the queue records none', bad);
end $$;

-- S8 house_till_names(p_restaurant_id, p_label) lists the names the ledger
-- counts on that row and how each joined, so the row record reads the lines
-- the Sold cell sums: the rakı's own name (exact) and its two sized names
-- (contains), not the Ala's; the label is read through beverage_house_key, so
-- case and word order do not matter. A tied row lists nothing.
-- [CHANGED 2026-10-06, F2 "List tied names on the row": a tied row lists the
-- names that tied on it, joined_by 'tie', with their lines. Was: nothing.]
do $$
declare got text; n integer;
begin
  select string_agg(t.item_name || '=' || t.joined_by || ':' || t.lines, ', ' order by t.item_name collate "C")
    into got
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'raki YENI zqss') t;
  assert got = 'Zqss Yeni Raki=exact:1, Zqss Yeni Raki (single 50ml)=contains:2, Zqss Yeni Raki 70cl bottle=contains:1',
    format('S8 FAIL the rakı''s record lists %s', got);
  select string_agg(t.item_name || '=' || t.joined_by || ':' || t.lines, ', ' order by t.item_name collate "C")
    into got
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'Zqss Lal Rose') t;
  assert got = 'Zqss Lal Rose Kavak (glass)=tie:1, Zqss Lal Rose Kavak Magnum=tie:1',
    format('S8 FAIL the tied rosé''s record lists %s; expected its two tied names', got);
  select string_agg(t.item_name || '=' || t.joined_by, ', ' order by t.item_name collate "C")
    into got
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'Zqss Fords Gin') t;
  assert got = 'Zqss Fords Gin (50ml)=contains, Zqss Fords Gin Fizz=contains',
    format('S8 FAIL the gin''s record lists %s', got);
end $$;

-- S9 the shape and the grants: the ledger keeps its signature and appends
-- five columns; house_till_lines gains sold_as; the new overload is
-- service_role only, like every till function.
-- [CHANGED 2026-10-06, F2: six columns, with tied_names. Was: five, 36.]
do $$
declare args text; ncols integer; f text;
begin
  select pg_get_function_identity_arguments(p.oid), coalesce(array_length(p.proallargtypes, 1), 0) - p.pronargs
    into args, ncols
    from pg_proc p
   where p.oid = 'public.house_beverage_ledger(uuid, integer)'::regprocedure;
  assert args = 'p_restaurant_id uuid, p_limit integer', format('S9 FAIL the ledger''s signature changed: %s', args);
  assert ncols = 37, format('S9 FAIL the ledger returns %s columns, expected 37', ncols);
  foreach f in array array['public.house_till_lines(uuid, text[])',
                           'public.house_till_names(uuid)',
                           'public.house_till_names(uuid, text)',
                           'public.house_beverage_ledger(uuid, integer)'] loop
    assert not has_function_privilege('anon', f, 'EXECUTE'), format('S9 FAIL anon can execute %s', f);
    assert not has_function_privilege('authenticated', f, 'EXECUTE'), format('S9 FAIL authenticated can execute %s', f);
    assert has_function_privilege('service_role', f, 'EXECUTE'), format('S9 FAIL service_role cannot execute %s', f);
  end loop;
end $$;

-- S10 (F1, 2026-10-06, "Also match without maker") a menu that carries
-- producers. The till's names hold none of these rows' full words (the
-- maker's are missing), so each tries the rows' names without the maker, by
-- the same rules: the draft and the bottled pilsner join the pilsner, the
-- malt's draft joins the malt (the most words), and 'Zqrd Rouge' joins the
-- row whose bare name is its key exactly, not the one level with it in words.
do $$
declare r record; got text; n integer;
begin
  select * into r from pg_temp.ss_row('Zqmk Anadolu Zqef Zqef Pilsner');
  assert r.pos_lines = 2 and r.poured_qty = 6 and r.poured_revenue = 40 + 18,
    format('S10 FAIL the pilsner reads pos_lines %s, Sold %s, Taken %s; expected 2, 6 and 58 (its draft and its bottle, without the maker)', r.pos_lines, r.poured_qty, r.poured_revenue);
  select * into r from pg_temp.ss_row('Zqmk Anadolu Zqef Zqef Pilsner Malt');
  assert r.pos_lines = 1 and r.poured_qty = 1,
    format('S10 FAIL the malt reads pos_lines %s, Sold %s; expected 1 and 1 (the more specific bare name)', r.pos_lines, r.poured_qty);
  select string_agg(t.item_name || '=' || t.joined_by || ':' || t.lines, ', ' order by t.item_name collate "C")
    into got
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'Zqmk Anadolu Zqef Zqef Pilsner') t;
  assert got = 'Zqef Pilsner=without_maker:1, Zqef Pilsner (draft 400ml)=without_maker:1',
    format('S10 FAIL the pilsner''s record lists %s', got);
  select * into r from pg_temp.ss_row('Zqmk Kavak Zqrd Rouge');
  assert r.pos_lines = 1, format('S10 FAIL the row whose bare name is the till''s reads pos_lines %s; expected 1', r.pos_lines);
  select * into r from pg_temp.ss_row('Zqmk Other Zqrd Zqrd Rouge');
  select l.tied_lines into n from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqmk Other Zqrd Zqrd Rouge';
  assert r.pos_lines = 0 and n = 0,
    format('S10 FAIL the row level in words reads pos_lines %s, tied_lines %s; expected 0 and 0 (an exact bare name wins outright)', r.pos_lines, n);
  -- Never queued and joined, none of these names is a row of its own.
  select count(*) into n
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label in ('Zqef Pilsner (draft 400ml)', 'Zqef Pilsner', 'Zqef Pilsner Malt (draft 500ml)', 'Zqrd Rouge');
  assert n = 0, format('S10 FAIL %s of the joined names are rows of their own', n);
end $$;

-- S11 (F1) the tie rule and the order of the passes, without the maker. Two
-- makers' 'Zqyk Yakut' rows are level: the glass joins neither, both count
-- its 2 lines as tied and list it. And a name that holds a row's full words
-- joins that row, never trying the bare names, even where one has more words:
-- 'Zqpr Gold Seri (single 50ml)' holds 'Zqpr Gold' and joins it, not the
-- maker's 'Zqpr Gold Seri' ("if a till name holds none of a row's full
-- words"). [CHANGED 2026-10-07, "Menu first": both rows here are menu rows;
-- a name that holds only an invoice, order or quote row's full words does
-- try the menu's bare names first (S18).]
do $$
declare r record; a integer; b integer; got text;
begin
  select l.pos_lines, l.tied_lines into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqmk Doluca Zqyk Yakut';
  assert r.pos_lines = 0 and r.tied_lines = 2,
    format('S11 FAIL the Doluca row reads pos_lines %s, tied_lines %s; expected 0 and 2 (a tie without the maker)', r.pos_lines, r.tied_lines);
  select l.pos_lines, l.tied_lines into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqmk Kavaklidere Zqyk Yakut';
  assert r.pos_lines = 0 and r.tied_lines = 2,
    format('S11 FAIL the Kavaklıdere row reads pos_lines %s, tied_lines %s; expected 0 and 2', r.pos_lines, r.tied_lines);
  select string_agg(t.item_name || '=' || t.joined_by || ':' || t.lines, ', ')
    into got
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'Zqmk Doluca Zqyk Yakut') t;
  assert got = 'Zqyk Yakut (glass)=tie:2', format('S11 FAIL the Doluca row''s record lists %s', got);
  select * into r from pg_temp.ss_row('Zqpr Gold');
  assert r.pos_lines = 1 and r.poured_qty = 2,
    format('S11 FAIL the plain gold reads pos_lines %s, Sold %s; expected 1 and 2 (its full words, first)', r.pos_lines, r.poured_qty);
  select * into r from pg_temp.ss_row('Zqmk Tekirdag Zqpr Gold Seri');
  assert r.pos_lines = 0, format('S11 FAIL the maker''s gold seri reads pos_lines %s; expected 0', r.pos_lines);
end $$;

-- S13 (F5, 2026-10-06, "Keep one rule") a catalogue-only row's record has no
-- till lines. No book of this house names 'Zqss Kalecik Karasi' (the
-- register shows it from the catalogue), so no row has its key and the
-- record lists nothing, though the till rang 'Zqss Kalecik Karasi (glass)',
-- which holds its words: the record lists exactly the lines a Sold cell
-- counts, and none counts that one. Before the 2026-10-05 build, the record
-- matched names with matchLine and would have listed it.
do $$
declare n integer;
begin
  select count(*) into n
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'Zqss Kalecik Karasi') t;
  assert n = 0, format('S13 FAIL the catalogue-only row''s record lists %s till names; expected 0', n);
  select count(*) into n
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.till_names @> '[{"item_name": "Zqss Kalecik Karasi (glass)"}]'::jsonb
      -- to_jsonb(l): the build before F2 has no tied_names column.
      or (to_jsonb(l) -> 'tied_names') @> '[{"item_name": "Zqss Kalecik Karasi (glass)"}]'::jsonb;
  assert n = 0, format('S13 FAIL %s rows count the catalogue-only name''s line; expected 0', n);
end $$;

-- S14 ("Menu first", 2026-10-06) the BLOCK's case: a menu row 'Zqyr Yeni
-- Rakı Âlâ' and a quote 'Zqyr Yeni Rakı 70cl'. Both Âlâ till names join the
-- menu row and the quote takes neither of them. The quote still takes a name
-- no menu row contains: 'Zqyr Yeni Rakı 70cl', its own key. Killed by the
-- build as it stood at 3f3689307 (every book alike, size words as any word),
-- where the quote's five words beat the Âlâ's four and it took the bottle.
-- Undoing only one of the two answers leaves it passing (the other still
-- keeps the Âlâ on the menu); S15 and S17 kill each one alone.
do $$
declare r record; got text; n integer;
begin
  select * into r from pg_temp.ss_row('Zqyr Yeni Rakı Âlâ');
  assert r.pos_lines = 2 and r.poured_qty = 5,
    format('S14 FAIL the menu''s Âlâ reads pos_lines %s, Sold %s; expected 2 and 5 (its bottle and its single)', r.pos_lines, r.poured_qty);
  select string_agg(t.item_name || '=' || t.joined_by || ':' || t.lines, ', ' order by t.item_name collate "C")
    into got
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'Zqyr Yeni Rakı 70cl') t;
  assert got = 'Zqyr Yeni Rakı 70cl=exact:1',
    format('S14 FAIL the quote''s record lists %s; expected only its own name (no Âlâ line)', got);
  select l.pos_lines, l.tied_lines into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqyr Yeni Rakı 70cl';
  assert r.pos_lines = 1 and r.tied_lines = 0,
    format('S14 FAIL the quote reads pos_lines %s, tied_lines %s; expected 1 and 0', r.pos_lines, r.tied_lines);
end $$;

-- S15 ("Menu first") a menu row against invoice rows that hold its words and
-- more. 'Zqmf Tekel Raki 70cl bottle' holds the menu's 'Zqmf Tekel Raki' and
-- the invoice's 'Zqmf Tekel Raki 70cl'; 'Zqmf Tekel Raki Ozel 70cl' holds the
-- menu's and the invoice's 'Zqmf Tekel Raki Ozel', which has a product word
-- more; 'Zqmf Tekel Raki 70cl' is the 70cl invoice row's own key. All three
-- join the menu row, the answer's stated cost ("a supplier's name never beats
-- the menu's, even when the menu's name is vaguer"), so an exact key on an
-- invoice row loses to a menu row the name contains, and neither invoice row
-- counts or ties on them. Killed by reading every book's rows alike (size
-- words still only breaking ties): the 70cl invoice wins the first on its
-- size and the third as exact, the Ozel the second on its product word.
do $$
declare r record;
begin
  select * into r from pg_temp.ss_row('Zqmf Tekel Raki');
  assert r.pos_lines = 3 and r.poured_qty = 7,
    format('S15 FAIL the menu row reads pos_lines %s, Sold %s; expected 3 and 7', r.pos_lines, r.poured_qty);
  select l.pos_lines, l.tied_lines into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqmf Tekel Raki 70cl';
  assert r.pos_lines = 0 and r.tied_lines = 0,
    format('S15 FAIL the sized invoice row reads pos_lines %s, tied_lines %s; expected 0 and 0', r.pos_lines, r.tied_lines);
  select l.pos_lines, l.tied_lines into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqmf Tekel Raki Ozel';
  assert r.pos_lines = 0 and r.tied_lines = 0,
    format('S15 FAIL the Ozel invoice row reads pos_lines %s, tied_lines %s; expected 0 and 0', r.pos_lines, r.tied_lines);
end $$;

-- S16 (size words "Only to break ties", 2026-10-06) the 35cl tie-break. The
-- menu's 'Zqtb Yeni Raki' and 'Zqtb Yeni Raki 35cl' are level on product
-- words (three each); 'Zqtb Yeni Raki 35cl (glass)' holds both, and the size
-- words decide: it joins the 35cl row. The 50 ml single holds only the plain
-- row's words and joins it. Killed by size words never counting: the glass
-- ties the two rows and joins neither.
do $$
declare r record; got text;
begin
  select * into r from pg_temp.ss_row('Zqtb Yeni Raki 35cl');
  assert r.pos_lines = 1 and r.poured_qty = 2,
    format('S16 FAIL the 35cl row reads pos_lines %s, Sold %s; expected 1 and 2 (the 35cl glass)', r.pos_lines, r.poured_qty);
  select string_agg(t.item_name || '=' || t.joined_by || ':' || t.lines, ', ' order by t.item_name collate "C")
    into got
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'Zqtb Yeni Raki') t;
  assert got = 'Zqtb Yeni Raki (single 50ml)=contains:1',
    format('S16 FAIL the plain row''s record lists %s', got);
  select l.tied_lines into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqtb Yeni Raki';
  assert r.tied_lines = 0, format('S16 FAIL the plain row reads tied_lines %s; expected 0', r.tied_lines);
end $$;

-- S17 (size words "Only to break ties") product words rank first, inside one
-- book. 'Zqaw Yeni Raki Ala 70cl bottle' holds the menu's 'Zqaw Yeni Raki
-- Ala' (four product words) and 'Zqaw Yeni Raki 70cl' (three, and two size
-- words): it joins the Ala. Killed by counting size words as any word, where
-- the 70cl row's five beat the Ala's four.
do $$
declare r record;
begin
  select * into r from pg_temp.ss_row('Zqaw Yeni Raki Ala');
  assert r.pos_lines = 1 and r.poured_qty = 1,
    format('S17 FAIL the Ala reads pos_lines %s, Sold %s; expected 1 and 1', r.pos_lines, r.poured_qty);
  select l.pos_lines, l.tied_lines into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqaw Yeni Raki 70cl';
  assert r.pos_lines = 0 and r.tied_lines = 0,
    format('S17 FAIL the 70cl row reads pos_lines %s, tied_lines %s; expected 0 and 0', r.pos_lines, r.tied_lines);
end $$;

-- S18 ("Menu first", with F1) the menu's name without its maker comes before
-- another book's full words. 'Zqbp Pilsen (draft 400ml)' holds the quote
-- 'Zqbp Pilsen' whole and the menu's 'Zqmk Anadolu' + 'Zqbp Pilsen' only
-- without the maker: it joins the menu row. Killed by reading other books'
-- full words before the menu's bare names (and by the build at 3f3689307,
-- where a name holding any row's full words never tried a bare name). An
-- order line's name without its maker still joins a name nothing else
-- holds: 'Zqob Lager (draft 400ml)' joins 'Zqmk Brewer' + 'Zqob Lager'; that
-- pins kept behaviour, as the earlier build joins it too.
do $$
declare r record; got text;
begin
  select string_agg(t.item_name || '=' || t.joined_by || ':' || t.lines, ', ')
    into got
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'Zqmk Anadolu Zqbp Pilsen') t;
  assert got = 'Zqbp Pilsen (draft 400ml)=without_maker:1',
    format('S18 FAIL the menu row''s record lists %s', got);
  select l.pos_lines, l.tied_lines into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqbp Pilsen';
  assert r.pos_lines = 0 and r.tied_lines = 0,
    format('S18 FAIL the quote reads pos_lines %s, tied_lines %s; expected 0 and 0', r.pos_lines, r.tied_lines);
  select string_agg(t.item_name || '=' || t.joined_by || ':' || t.lines, ', ')
    into got
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'Zqmk Brewer Zqob Lager') t;
  assert got = 'Zqob Lager (draft 400ml)=without_maker:1',
    format('S18 FAIL the order row''s record lists %s', got);
end $$;

-- S19 (size words "Only to break ties", without the maker) size words tell
-- the menu's names without their maker apart too. 'Zqmk Tekel' with 'Zqbs
-- Yeni Raki', 'Zqbs Yeni Raki 35cl' and 'Zqbs Yeni Raki 70cl' are level on
-- product words without the maker (three each), and the till's names hold
-- none of their full words. 'Zqbs Yeni Raki 35cl (glass)' holds the plain
-- row's bare name and the 35cl row's, and joins the 35cl row; 'Zqbs Yeni
-- Raki 70cl bottle' holds the plain row's and the 70cl row's, and joins the
-- 70cl row. The plain row neither counts nor ties on them. S16 is the same
-- rule on full words. Killed by forcing the bare pass's size words to 0
-- (reach_bare's `r.n - r.p AS s`), where each name ties its two rows and
-- joins neither.
do $$
declare r record; got text;
begin
  select * into r from pg_temp.ss_row('Zqmk Tekel Zqbs Yeni Raki 35cl');
  assert r.pos_lines = 1 and r.poured_qty = 2,
    format('S19 FAIL the 35cl row reads pos_lines %s, Sold %s; expected 1 and 2 (the 35cl glass, without the maker)', r.pos_lines, r.poured_qty);
  select string_agg(t.item_name || '=' || t.joined_by || ':' || t.lines, ', ' order by t.item_name collate "C")
    into got
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'Zqmk Tekel Zqbs Yeni Raki 35cl') t;
  assert got = 'Zqbs Yeni Raki 35cl (glass)=without_maker:1',
    format('S19 FAIL the 35cl row''s record lists %s', got);
  select * into r from pg_temp.ss_row('Zqmk Tekel Zqbs Yeni Raki 70cl');
  assert r.pos_lines = 1 and r.poured_qty = 1,
    format('S19 FAIL the 70cl row reads pos_lines %s, Sold %s; expected 1 and 1 (the 70cl bottle, without the maker)', r.pos_lines, r.poured_qty);
  select l.pos_lines, l.tied_lines into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqmk Tekel Zqbs Yeni Raki';
  assert r.pos_lines = 0 and r.tied_lines = 0,
    format('S19 FAIL the plain row reads pos_lines %s, tied_lines %s; expected 0 and 0', r.pos_lines, r.tied_lines);
end $$;

-- S20 ("Menu first") an order row is a supplier row, whatever its words.
-- The till's 'Zqot Raki Ozel 70cl' holds the menu's 'Zqot Raki' and the
-- order line 'Zqot Raki Ozel', which has a product word more. It joins the
-- menu row, and the order row neither counts nor ties on it. Killed by
-- reading the order book's rows as menu rows (tier 1), where the order
-- row's extra product word wins the name.
do $$
declare r record;
begin
  select * into r from pg_temp.ss_row('Zqot Raki');
  assert r.pos_lines = 1 and r.poured_qty = 2,
    format('S20 FAIL the menu row reads pos_lines %s, Sold %s; expected 1 and 2', r.pos_lines, r.poured_qty);
  select l.pos_lines, l.tied_lines into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqot Raki Ozel';
  assert r.pos_lines = 0 and r.tied_lines = 0,
    format('S20 FAIL the order row reads pos_lines %s, tied_lines %s; expected 0 and 0', r.pos_lines, r.tied_lines);
end $$;

-- S21 (F1 under "Menu first") among the supplier rows too, a row's every
-- word comes before an order row's name without its maker (pass 3 before
-- pass 4). No menu row holds the till's 'Zqfp Lager Gold (draft 400ml)'. It
-- holds the quote 'Zqfp Lager' whole and the order line 'Zqmk Brauhaus' +
-- 'Zqfp Lager Gold' only without the maker, and joins the quote's row,
-- though the order's bare name has a product word more. Killed by reading
-- passes 3 and 4 as one, where that word wins the name.
do $$
declare r record; got text;
begin
  select string_agg(t.item_name || '=' || t.joined_by || ':' || t.lines, ', ')
    into got
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'Zqfp Lager') t;
  assert got = 'Zqfp Lager Gold (draft 400ml)=contains:1',
    format('S21 FAIL the quote''s record lists %s', got);
  select l.pos_lines, l.tied_lines into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqmk Brauhaus Zqfp Lager Gold';
  assert r.pos_lines = 0 and r.tied_lines = 0,
    format('S21 FAIL the order row reads pos_lines %s, tied_lines %s; expected 0 and 0', r.pos_lines, r.tied_lines);
end $$;

-- S22 (size words "Only to break ties", without the maker) a product word
-- beats a size without the maker too. The till's 'Zqbw Yeni Raki Ala 70cl
-- bottle' holds the bare names of 'Zqmk Efendi' with 'Zqbw Yeni Raki Ala'
-- (four product words) and with 'Zqbw Yeni Raki 70cl' (three, and two size
-- words), and joins the Ala. S17 is the same rule on full words. Killed by
-- counting the bare names' size words as product words (bare_word's `p`),
-- where the 70cl row's five beat the Ala's four.
do $$
declare r record;
begin
  select * into r from pg_temp.ss_row('Zqmk Efendi Zqbw Yeni Raki Ala');
  assert r.pos_lines = 1 and r.poured_qty = 1,
    format('S22 FAIL the Ala reads pos_lines %s, Sold %s; expected 1 and 1', r.pos_lines, r.poured_qty);
  select l.pos_lines, l.tied_lines into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqmk Efendi Zqbw Yeni Raki 70cl';
  assert r.pos_lines = 0 and r.tied_lines = 0,
    format('S22 FAIL the 70cl row reads pos_lines %s, tied_lines %s; expected 0 and 0', r.pos_lines, r.tied_lines);
end $$;

-- S23 (size words "Only to break ties") a row's size words are read from
-- every book's labels, not the menu's alone. Two invoice rows no menu row
-- holds: 'Zqiv Raki Ozel' (three product words) and 'Zqiv Raki 70cl' (two,
-- and two size words, written in the invoice's own line). The till's 'Zqiv
-- Raki Ozel 70cl' holds both and joins the Ozel. Killed by reading size
-- words from menu labels only, where the invoice's '70' and 'cl' count as
-- product words and its four beat three.
do $$
declare r record;
begin
  select * into r from pg_temp.ss_row('Zqiv Raki Ozel');
  assert r.pos_lines = 1 and r.poured_qty = 1,
    format('S23 FAIL the Ozel invoice row reads pos_lines %s, Sold %s; expected 1 and 1', r.pos_lines, r.poured_qty);
  select l.pos_lines, l.tied_lines into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqiv Raki 70cl';
  assert r.pos_lines = 0 and r.tied_lines = 0,
    format('S23 FAIL the sized invoice row reads pos_lines %s, tied_lines %s; expected 0 and 0', r.pos_lines, r.tied_lines);
end $$;

-- S24 (size words "Only to break ties", pass 4) size words tell order rows
-- apart without their maker too. The order lines 'Zqmk Imbik' with 'Zqos
-- Yeni Raki' and with 'Zqos Yeni Raki 35cl' are level on product words
-- without the maker (three each). No menu row and no supplier row's full
-- words reach the till's 'Zqos Yeni Raki 35cl (glass)', which holds both
-- rows' names without the maker: it joins the 35cl row, and the plain row
-- neither counts nor ties on it. S19 is the same rule on menu rows (pass 2).
-- Killed by forcing pass 4's size words to 0 (reach_bare's `CASE WHEN
-- r.tier = 2 THEN 0 ELSE r.n - r.p END AS s`), where the glass ties the two
-- rows and joins neither.
do $$
declare r record; got text;
begin
  select * into r from pg_temp.ss_row('Zqmk Imbik Zqos Yeni Raki 35cl');
  assert r.pos_lines = 1 and r.poured_qty = 2,
    format('S24 FAIL the 35cl order row reads pos_lines %s, Sold %s; expected 1 and 2 (the 35cl glass, without the maker)', r.pos_lines, r.poured_qty);
  select string_agg(t.item_name || '=' || t.joined_by || ':' || t.lines, ', ' order by t.item_name collate "C")
    into got
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'Zqmk Imbik Zqos Yeni Raki 35cl') t;
  assert got = 'Zqos Yeni Raki 35cl (glass)=without_maker:1',
    format('S24 FAIL the 35cl order row''s record lists %s', got);
  select l.pos_lines, l.tied_lines into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqmk Imbik Zqos Yeni Raki';
  assert r.pos_lines = 0 and r.tied_lines = 0,
    format('S24 FAIL the plain order row reads pos_lines %s, tied_lines %s; expected 0 and 0', r.pos_lines, r.tied_lines);
end $$;

-- S25 (size words "Only to break ties", pass 4) a product word beats a size
-- among order rows without their maker. The till's 'Zqow Yeni Raki Ala 70cl
-- bottle' holds the names without the maker of 'Zqmk Kazan' with 'Zqow Yeni
-- Raki Ala' (four product words) and with 'Zqow Yeni Raki 70cl' (three, and
-- two size words), and joins the Ala. S22 is the same rule on menu rows.
-- Killed by counting pass 4's size words as product words (bare_word's `p`
-- with `OR bk.tier = 2` in its filter), where the 70cl row's five beat the
-- Ala's four.
do $$
declare r record;
begin
  select * into r from pg_temp.ss_row('Zqmk Kazan Zqow Yeni Raki Ala');
  assert r.pos_lines = 1 and r.poured_qty = 1,
    format('S25 FAIL the Ala order row reads pos_lines %s, Sold %s; expected 1 and 1', r.pos_lines, r.poured_qty);
  select l.pos_lines, l.tied_lines into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqmk Kazan Zqow Yeni Raki 70cl';
  assert r.pos_lines = 0 and r.tied_lines = 0,
    format('S25 FAIL the 70cl order row reads pos_lines %s, tied_lines %s; expected 0 and 0', r.pos_lines, r.tied_lines);
end $$;

-- S26 (F1, pass 4) an exact name without the maker wins outright among order
-- rows too. 'Zqmk Bagci' with 'Zqoe Rouge' and 'Zqmk Diger' with 'Zqoe Zqoe
-- Rouge' have the same two distinct words without the maker; the till's
-- 'Zqoe Rouge' is the first's name without its maker exactly, and joins it.
-- The other neither counts nor ties on it. S10 is the same rule on menu
-- rows. Killed by reading pass 4's names as never exact (reach_bare's
-- `bool_or(r.bare_k = r.name_k AND r.tier = 1)`), where the two rows tie.
do $$
declare r record; got text;
begin
  select * into r from pg_temp.ss_row('Zqmk Bagci Zqoe Rouge');
  assert r.pos_lines = 1 and r.poured_qty = 1,
    format('S26 FAIL the exact order row reads pos_lines %s, Sold %s; expected 1 and 1', r.pos_lines, r.poured_qty);
  select string_agg(t.item_name || '=' || t.joined_by || ':' || t.lines, ', ' order by t.item_name collate "C")
    into got
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'Zqmk Bagci Zqoe Rouge') t;
  assert got = 'Zqoe Rouge=without_maker:1',
    format('S26 FAIL the exact order row''s record lists %s', got);
  select l.pos_lines, l.tied_lines into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqmk Diger Zqoe Zqoe Rouge';
  assert r.pos_lines = 0 and r.tied_lines = 0,
    format('S26 FAIL the order row level in words reads pos_lines %s, tied_lines %s; expected 0 and 0 (an exact name without the maker wins outright)', r.pos_lines, r.tied_lines);
end $$;

-- S27 (F1 and F2, pass 4) a tie among order rows joins neither. 'Zqmk Sarap'
-- and 'Zqmk Asma' each with 'Zqoy Yakut' are level on everything without
-- the maker; the till's 'Zqoy Yakut (glass)' counts on neither's Sold, and
-- each counts its line as tied and lists it. S11 is the same rule on menu
-- rows. Killed by never calling a pass-4 pick a tie (pick's tie test with
-- `AND c.pass <> 4`), where both rows count the line.
do $$
declare r record; got text;
begin
  select l.pos_lines, l.tied_lines into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqmk Sarap Zqoy Yakut';
  assert r.pos_lines = 0 and r.tied_lines = 1,
    format('S27 FAIL the Sarap order row reads pos_lines %s, tied_lines %s; expected 0 and 1 (a tie without the maker)', r.pos_lines, r.tied_lines);
  select l.pos_lines, l.tied_lines into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqmk Asma Zqoy Yakut';
  assert r.pos_lines = 0 and r.tied_lines = 1,
    format('S27 FAIL the Asma order row reads pos_lines %s, tied_lines %s; expected 0 and 1', r.pos_lines, r.tied_lines);
  select string_agg(t.item_name || '=' || t.joined_by || ':' || t.lines, ', ')
    into got
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'Zqmk Sarap Zqoy Yakut') t;
  assert got = 'Zqoy Yakut (glass)=tie:1', format('S27 FAIL the Sarap order row''s record lists %s', got);
end $$;

rollback;
