/**
 * A drink's photo (r110 drinks-g3): one per drink, on its recipe sheet, its
 * recipe card and the spec book, so a new bartender sees what the drink looks
 * like when it goes out.
 *
 * - Kept in the PRIVATE bucket `drink-photos`, written and read only by the
 *   gateway's service key. A public bucket was rejected (a house's specs are
 *   its own), and so was a client upload with the anon key (it would need
 *   storage policies keyed on a claim the browser holds, and would skip the
 *   metadata strip below).
 * - The path is `<restaurant_id>/<cocktail_id>/<uuid>.<ext>`, and the drink is
 *   found with `.eq("restaurant_id")`, so another house's drink is a 404 and a
 *   stored file can only ever sit under the house that owns the drink.
 * - Every metadata block is removed before storing (drink-photo.ts): EXIF GPS
 *   would put the house's location in a stored file.
 * - A read gives `photoUrl`, a signed URL good for 10 minutes, to any role of
 *   the house: a photo is not money. A failed photo read gives no photo and is
 *   logged; it never fails the recipe or the book it decorates.
 */
import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseService } from "../database/database.service";
import { cleanPhoto, photoPath } from "./drink-photo";

export const PHOTO_BUCKET = "drink-photos";
/** A signed photo URL lives 10 minutes: long enough to print a book, short enough not to be a standing link. */
export const PHOTO_URL_SECONDS = 600;
export const PHOTO_NOT_STORED = "The photo could not be stored just now. Nothing was changed.";
const CHUNK = 100;
/** recipes.service NOT_THIS_HOUSE, the same words (not imported: recipes.service reads photos from here). */
export const DRINK_NOT_THIS_HOUSE = "This drink is not on this house's list.";

const logger = new Logger("DrinkPhoto");

/** One drink's photo URL, or null when it has none or the read failed. */
export async function photoUrlOf(client: SupabaseClient, restaurantId: string, cocktailId: string): Promise<string | null> {
  return (await photoUrlsOf(client, restaurantId, [cocktailId])).get(cocktailId) ?? null;
}

/** Each drink's photo URL by id, for the drinks that have one; a failed read gives none. */
export async function photoUrlsOf(client: SupabaseClient, restaurantId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await client
        .from("cocktails")
        .select("id, photo_path")
        .eq("restaurant_id", restaurantId)
        .in("id", ids.slice(i, i + CHUNK))
        .not("photo_path", "is", null);
      if (error) throw error;
      const rows = ((data ?? []) as Array<{ id: string; photo_path: string | null }>).filter(
        // A path not under this house is never signed, whatever the row says.
        (r) => typeof r.photo_path === "string" && r.photo_path.startsWith(`${restaurantId}/`),
      );
      if (rows.length === 0) continue;
      const signed = await client.storage.from(PHOTO_BUCKET).createSignedUrls(
        rows.map((r) => r.photo_path as string),
        PHOTO_URL_SECONDS,
      );
      if (signed.error) throw signed.error;
      const byPath = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
      for (const r of rows) {
        const url = byPath.get(r.photo_path as string);
        if (url) out.set(r.id, url);
      }
    }
  } catch (err) {
    logger.warn(`drink photo read failed: ${(err as { message?: string })?.message ?? String(err)}`);
    return new Map();
  }
  return out;
}

@Injectable()
export class DrinkPhotoService {
  constructor(private readonly db: DatabaseService) {}

  private async houseDrink(restaurantId: string, cocktailId: string): Promise<{ id: string; photo_path: string | null }> {
    const { data, error } = await this.db
      .getClient()
      .from("cocktails")
      .select("id, photo_path")
      .eq("id", cocktailId)
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new ServiceUnavailableException(PHOTO_NOT_STORED);
    if (!data) throw new NotFoundException(DRINK_NOT_THIS_HOUSE);
    return data as { id: string; photo_path: string | null };
  }

  /** The old file goes once the new one is the drink's; a failure there leaves an unreferenced file, never a lost photo. */
  private async dropFile(path: string | null) {
    if (!path) return;
    const { error } = await this.db.getClient().storage.from(PHOTO_BUCKET).remove([path]);
    if (error) logger.warn(`old drink photo not removed (${path}): ${error.message}`);
  }

  /** PUT: store the photo, cleaned, as the drink's one photo. */
  async put(restaurantId: string, cocktailId: string, imageBase64: string): Promise<{ photoUrl: string | null }> {
    const old = (await this.houseDrink(restaurantId, cocktailId)).photo_path;
    const raw = Buffer.from(imageBase64.replace(/^data:[^,]*,/, ""), "base64");
    const clean = cleanPhoto(raw);
    if ("refused" in clean) throw new BadRequestException(clean.refused);
    const client = this.db.getClient();
    const path = photoPath(restaurantId, cocktailId, randomUUID(), clean.type.ext);
    const up = await client.storage.from(PHOTO_BUCKET).upload(path, clean.bytes, { contentType: clean.type.mime, upsert: false });
    if (up.error) throw new ServiceUnavailableException(PHOTO_NOT_STORED);
    const { error } = await client
      .from("cocktails")
      .update({ photo_path: path })
      .eq("id", cocktailId)
      .eq("restaurant_id", restaurantId);
    if (error) {
      await this.dropFile(path);
      throw new ServiceUnavailableException(PHOTO_NOT_STORED);
    }
    await this.dropFile(old);
    return { photoUrl: await photoUrlOf(client, restaurantId, cocktailId) };
  }

  /** DELETE: the drink has no photo, and its file goes. */
  async remove(restaurantId: string, cocktailId: string): Promise<{ photoUrl: null }> {
    const old = (await this.houseDrink(restaurantId, cocktailId)).photo_path;
    const { error } = await this.db
      .getClient()
      .from("cocktails")
      .update({ photo_path: null })
      .eq("id", cocktailId)
      .eq("restaurant_id", restaurantId);
    if (error) throw new ServiceUnavailableException(PHOTO_NOT_STORED);
    await this.dropFile(old);
    return { photoUrl: null };
  }
}
