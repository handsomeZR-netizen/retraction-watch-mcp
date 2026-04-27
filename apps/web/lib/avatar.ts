export const AVATAR_STYLES = [
  "lorelei",
  "thumbs",
  "shapes",
  "identicon",
  "bottts-neutral",
  "fun-emoji",
  "notionists-neutral",
] as const;

export type AvatarStyle = (typeof AVATAR_STYLES)[number];

const DEFAULT_STYLE: AvatarStyle = "lorelei";

export function avatarUrl(seed: string | null, options?: { style?: AvatarStyle; size?: number }): string {
  const style = options?.style ?? DEFAULT_STYLE;
  const size = options?.size ?? 80;
  const safeSeed = encodeURIComponent(seed && seed.trim() ? seed : "anonymous");
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${safeSeed}&size=${size}&radius=50`;
}
