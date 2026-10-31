// Product data. One object per flavor.
//
// Photos: put the file in /public/products/ and set `image`, e.g.
//   image: "/products/carrot.jpg"
// While `image` is null the site draws the jar label instead of a photo.
//
// kcal values come from the approved nutrition labels (see `nutrition`), per average piece.

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
  // The printed nutrition label (same numbers as the jar's label), shown on the product page.
  nutrition: Nutrition;
};

// From the approved nutrition labels. Values are estimated from the recipe;
// a serving is 3 pieces and pieces are not identical in weight (hence "average piece").
export type Nutrition = {
  image: string; // the label picture, /public/products/nutrition/<slug>.png
  servingG: number;
  pieceG: number;
  kcalServing: number;
  kcalPiece: number;
  fatG: number; // per serving
  satFatG: number;
  sodiumMg: number;
  carbG: number;
  fibreG: number;
  sugarsG: number;
  addedSugarsG: number;
  maltitolG: number;
  proteinG: number;
  // Full ingredient list as printed on the label (English + Arabic).
  ingredientsEn: string;
  ingredientsAr: string;
  containsEn: string;
  containsAr: string;
};

const PRICE = 15000;

export const products: Product[] = [
  {
    slug: "dark-chocolate",
    nameEn: "Dark Chocolate",
    nameAr: "شوكولاتة داكنة",
    kcalPerPiece: 38,
    price: PRICE,
    band: "#2E2926",
    // CONFIRM: wording written to match the peanut butter description.
    taste: "طعم الشوكولاتة الداكنة الغني بقوام كريمي",
    // CONFIRM: add this flavor's own points (chocolate origin, cocoa, fats).
    points: [],
    // CONFIRM: taken from the peanut butter description (Belgian chocolate, Dutch cocoa).
    ingredients: ["خضار", "شوكولاتة بلجيكية داكنة", "كاكاو هولندي خام", "بدائل سكر إسبانية المنشأ"],
    image: "/products/dark-chocolate.jpg",
    nutrition: {
      image: "/products/nutrition/dark-chocolate.png",
      servingG: 37.5,
      pieceG: 12.5,
      kcalServing: 115,
      kcalPiece: 38,
      fatG: 6.9,
      satFatG: 3.8,
      sodiumMg: 11,
      carbG: 15.6,
      fibreG: 2.9,
      sugarsG: 0.9,
      addedSugarsG: 0,
      maltitolG: 3.1,
      proteinG: 2.7,
      ingredientsEn: "Chickpeas, dark chocolate, glycerin, raw cacao powder, coffee, ground vanilla, salt, stevia.",
      ingredientsAr: "حمص، شوكولاتة داكنة، غليسيرين، مسحوق كاكاو خام، قهوة، فانيلا مطحونة، ملح، ستيفيا.",
      containsEn: "Soy.",
      containsAr: "صويا.",
    },
  },
  {
    slug: "carrot",
    nameEn: "Carrot",
    nameAr: "جزر",
    kcalPerPiece: 28,
    price: PRICE,
    band: "#9A513C",
    // CONFIRM: the original line was cut off on the old store after "مع لذة ط...".
    taste: "طعم الشوكولاتة البيضاء المميز مع لذة الجزر",
    // CONFIRM: add this flavor's own points.
    points: [],
    // CONFIRM: white chocolate comes from the old store description; confirm the rest.
    ingredients: ["خضار", "جزر", "شوكولاتة بيضاء", "بدائل سكر إسبانية المنشأ"],
    image: "/products/carrot.jpg",
    nutrition: {
      image: "/products/nutrition/carrot.png",
      servingG: 33,
      pieceG: 11,
      kcalServing: 83,
      kcalPiece: 28,
      fatG: 3.9,
      satFatG: 1.8,
      sodiumMg: 69,
      carbG: 11.2,
      fibreG: 3.0,
      sugarsG: 4.7,
      addedSugarsG: 0,
      maltitolG: 1.1,
      proteinG: 1.9,
      ingredientsEn: "Carrot, white chocolate, coconut flour, walnut, rice flour, cardamom, coconut flavouring, ground vanilla, stevia, cinnamon, salt.",
      ingredientsAr: "جزر، شوكولاتة بيضاء، طحين جوز الهند، جوز، طحين رز، هيل، نكهة جوز الهند، فانيلا مطحونة، ستيفيا، قرفة، ملح.",
      containsEn: "Milk, soy, tree nuts (walnut), coconut.",
      containsAr: "حليب، صويا، مكسرات (جوز)، جوز الهند.",
    },
  },
  {
    slug: "hazelnut",
    nameEn: "Hazelnut",
    nameAr: "شوكولاتة داكنة بالبندق",
    kcalPerPiece: 45,
    price: PRICE,
    band: "#8A5C35",
    // CONFIRM: wording written to match the peanut butter description.
    taste: "طعم الشوكولاتة الداكنة المميز مع لذة البندق",
    // CONFIRM: add this flavor's own points.
    points: [],
    // CONFIRM: based on the peanut butter description with hazelnut in place of peanut.
    ingredients: ["خضار", "شوكولاتة بلجيكية داكنة", "بندق", "كاكاو هولندي خام", "بدائل سكر إسبانية المنشأ"],
    image: "/products/hazelnut.jpg",
    nutrition: {
      image: "/products/nutrition/hazelnut.png",
      servingG: 40.8,
      pieceG: 13.6,
      kcalServing: 135,
      kcalPiece: 45,
      fatG: 8.9,
      satFatG: 4.0,
      sodiumMg: 11,
      carbG: 16.1,
      fibreG: 3.2,
      sugarsG: 1.1,
      addedSugarsG: 0,
      maltitolG: 3.1,
      proteinG: 3.2,
      ingredientsEn: "Chickpeas, dark chocolate, glycerin, hazelnuts, raw cacao powder, coffee, ground vanilla, salt, stevia.",
      ingredientsAr: "حمص، شوكولاتة داكنة، غليسيرين، بندق، مسحوق كاكاو خام، قهوة، فانيلا مطحونة، ملح، ستيفيا.",
      containsEn: "Soy, tree nuts (hazelnut).",
      containsAr: "صويا، مكسرات (بندق).",
    },
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
    nutrition: {
      image: "/products/nutrition/peanut-butter.png",
      servingG: 40.7,
      pieceG: 13.6,
      kcalServing: 132,
      kcalPiece: 44,
      fatG: 8.5,
      satFatG: 4.1,
      sodiumMg: 11,
      carbG: 16.1,
      fibreG: 3.1,
      sugarsG: 1.1,
      addedSugarsG: 0,
      maltitolG: 3.1,
      proteinG: 3.5,
      ingredientsEn: "Chickpeas, dark chocolate, glycerin, peanuts, raw cacao powder, coffee, ground vanilla, salt, stevia.",
      ingredientsAr: "حمص، شوكولاتة داكنة، غليسيرين، فول سوداني، مسحوق كاكاو خام، قهوة، فانيلا مطحونة، ملح، ستيفيا.",
      containsEn: "Soy, peanuts.",
      containsAr: "صويا، فول سوداني.",
    },
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
export const nutNote = "تحتوي جميع النكهات على الصويا. الجزر: حليب، جوز، جوز الهند. البندق: مكسرات (بندق). الفول السوداني: فول سوداني.";

export function getProduct(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug);
}
