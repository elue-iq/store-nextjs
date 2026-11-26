// Line icons for the links and nutrition pages (decorative: each sits next to its words or
// inside a labelled link).

const base = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const IconInstagram = () => (
  <svg {...base}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <path d="M17.2 6.8v.01" />
  </svg>
);

export const IconWhatsApp = () => (
  <svg {...base}>
    <path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.8L4 20z" />
    <path d="M9.2 8.8c0 3 2.6 6 6 6l1-1.4-2-1-1 .8c-1-.4-2-1.4-2.4-2.4l.8-1-1-2-1.4 1z" />
  </svg>
);

export const IconTikTok = () => (
  <svg {...base}>
    <path d="M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5" />
    <path d="M14 4c.4 2.6 2.2 4.3 5 4.5" />
  </svg>
);

export const IconLinkedIn = () => (
  <svg {...base}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <path d="M8 10.5V16M8 7.8v.01M11.5 16v-5.5M11.5 13c0-1.6 1-2.5 2.3-2.5S16 11.3 16 13v3" />
  </svg>
);

export const IconBag = () => (
  <svg {...base}>
    <path d="M6 8h12l-1 12H7L6 8z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </svg>
);

export const IconStar = () => (
  <svg {...base}>
    <path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6L12 4z" />
  </svg>
);

export const IconLeaf = () => (
  <svg {...base}>
    <path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z" />
    <path d="M5 19l7-7" />
  </svg>
);

export const IconCheck = () => (
  <svg {...base} strokeWidth={2.4}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

// In right-to-left pages "forward" points left and "back" points right.
export const IconForward = () => (
  <svg {...base} width={20} height={20} strokeWidth={2}>
    <path d="M15 6l-6 6 6 6" />
  </svg>
);

export const IconBack = () => (
  <svg {...base} width={18} height={18} strokeWidth={2}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const IconInfo = () => (
  <svg {...base} width={18} height={18} strokeWidth={2}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16.5v.01" />
  </svg>
);
