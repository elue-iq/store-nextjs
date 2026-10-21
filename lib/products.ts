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
  // Flavor-specific points. Shared points (no added sugar or fat, vegetables,
  // no preservatives, calculated calories) are added on the product page for every flavor.
  points: string[];
  // Main ingredients of this flavor, shown on the product page and in the
  // ingredients section. Names only, no quantities.
  ingredients: string[];
  image: string | null;
};

const PRICE = 15000;

export const products: Product[] = [
  {
    slug: "dark-chocolate",
    nameEn: "Dark Chocolate",
    nameAr: "شوكولاتة داكنة",
    kcalPerPiece: 37,
    price: PRICE,
    band: "#2E2926",
    // CONFIRM: wording written to match the peanut butter description.
    taste: "طعم الشوكولاتة الداكنة الغني بقوام كريمي",
    // CONFIRM: add this flavor's own points (chocolate origin, cocoa, fats).
    points: [],
    // CONFIRM: taken from the peanut butter description (Belgian chocolate, Dutch cocoa).
    ingredients: ["خضار", "شوكولاتة بلجيكية داكنة", "كاكاو هولندي خام", "بدائل سكر إسبانية المنشأ"],
    image: "/products/dark-chocolate.jpg",
  },
  {
    slug: "carrot",
    nameEn: "Carrot",
    nameAr: "جزر",
    kcalPerPiece: 34,
    price: PRICE,
    band: "#9A513C",
    // CONFIRM: the original line was cut off on the old store after "مع لذة ط...".
    taste: "طعم الشوكولاتة البيضاء المميز مع لذة الجزر",
    // CONFIRM: add this flavor's own points.
    points: [],
    // CONFIRM: white chocolate comes from the old store description; confirm the rest.
    ingredients: ["خضار", "جزر", "شوكولاتة بيضاء", "بدائل سكر إسبانية المنشأ"],
    image: "/products/carrot.jpg",
  },
  {
    slug: "hazelnut",
    nameEn: "Hazelnut",
    nameAr: "شوكولاتة داكنة بالبندق",
    kcalPerPiece: 43,
    price: PRICE,
    band: "#8A5C35",
    // CONFIRM: wording written to match the peanut butter description.
    taste: "طعم الشوكولاتة الداكنة المميز مع لذة البندق",
    // CONFIRM: add this flavor's own points.
    points: [],
    // CONFIRM: based on the peanut butter description with hazelnut in place of peanut.
    ingredients: ["خضار", "شوكولاتة بلجيكية داكنة", "بندق", "كاكاو هولندي خام", "بدائل سكر إسبانية المنشأ"],
    image: "/products/hazelnut.jpg",
  },
  {
    slug: "peanut-butter",
    nameEn: "Peanut Butter",
    nameAr: "شوكولاتة داكنة بالفول السوداني",
    kcalPerPiece: 44,
    price: PRICE,
    band: "#7A6736",
    taste: "طعم الشوكولاتة الداكنة المميز مع لذة الفول السوداني المملّح",
    points: [
      "خالية من الزيوت المهدرجة",
      "شوكولاتة بلجيكية داكنة بلا سكر مضاف",
      "كاكاو هولندي خام",
      "بدائل سكر إسبانية المنشأ",
    ],
    ingredients: ["خضار", "شوكولاتة بلجيكية داكنة", "فول سوداني مملّح", "كاكاو هولندي خام", "بدائل سكر إسبانية المنشأ"],
    image: "/products/peanut-butter.jpg",
  },
];

// Points that are true for every flavor.
export const sharedPoints = [
  "بلا سكر مضاف، وبلا دهون أو زبدة مضافة",
  "خضار بنسبة لا تقل عن 60%، وغنية بالألياف",
  "بلا مواد حافظة",
  "قليلة ومحسوبة السعرات",
];

// Flavors that contain nuts, for the allergy note.
export const nutNote = "تحتوي نكهة البندق على البندق، وتحتوي نكهة الفول السوداني على الفول السوداني.";

export function getProduct(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug);
}
