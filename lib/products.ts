// Product data. One object per flavor.
//
// Photos: put the file in /public/products/ and set `image`, e.g.
//   image: "/products/carrot.jpg"
// While `image` is null the site draws the jar label instead of a photo.
//
// kcal values are copied from the printed jar labels ("kcal average piece").

export type ProductSlug = "dark-chocolate" | "carrot" | "hazelnut" | "peanut-butter";

export type Product = {
  slug: ProductSlug;
  nameEn: string;
  nameAr: string;
  kcalPerPiece: number;
  price: number; // IQD
  // Band colour from the printed label (slightly deepened so text on it stays readable).
  band: string;
  // First line of the product description: what it tastes like.
  taste: string;
  // Flavor-specific points. Shared points (no added sugar, vegetables, calculated
  // calories) are added on the product page for every flavor.
  points: string[];
  image: string | null;
};

const PRICE = 15000;

export const products: Product[] = [
  {
    slug: "dark-chocolate",
    nameEn: "Dark Chocolate",
    nameAr: "دارك چوكليت",
    kcalPerPiece: 37,
    price: PRICE,
    band: "#2E2926",
    // CONFIRM: wording written to match the peanut butter description.
    taste: "طعم الدارك چوكليت الغني بقوام كريمي",
    // CONFIRM: add this flavor's own points (chocolate origin, cocoa, fats).
    points: [],
    image: null,
  },
  {
    slug: "carrot",
    nameEn: "Carrot",
    nameAr: "جزر",
    kcalPerPiece: 34,
    price: PRICE,
    band: "#9A513C",
    // CONFIRM: the original line was cut off on the old store after "مع لذة ط...".
    taste: "طعم الوايت چوكليت المميز مع لذة الجزر",
    // CONFIRM: add this flavor's own points.
    points: [],
    image: null,
  },
  {
    slug: "hazelnut",
    nameEn: "Hazelnut",
    nameAr: "دارك چوكليت بالبندق",
    kcalPerPiece: 43,
    price: PRICE,
    band: "#8A5C35",
    // CONFIRM: wording written to match the peanut butter description.
    taste: "طعم الدارك چوكليت المميز مع لذة البندق",
    // CONFIRM: add this flavor's own points.
    points: [],
    image: null,
  },
  {
    slug: "peanut-butter",
    nameEn: "Peanut Butter",
    nameAr: "دارك چوكليت بالفول السوداني",
    kcalPerPiece: 44,
    price: PRICE,
    band: "#7A6736",
    taste: "طعم الدارك چوكليت المميز مع لذة الفول السوداني المملح",
    points: [
      "بدون زبدة أو دهون مضافة، وخالية من الزيوت المهدرجة",
      "دارك شوكولاتة بلجيكية بدون سكر مضاف",
      "كاكاو هولندي خام",
      "بدائل سكر إسبانية المنشأ",
    ],
    image: null,
  },
];

// Points that are true for every flavor.
export const sharedPoints = [
  "بدون سكر مضاف",
  "ما لا يقل عن 60% خضار، وغنية بالألياف",
  "سعرات محسوبة لكل قطعة، حتى تعرفون شنو تختارون",
];

export function getProduct(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug);
}
