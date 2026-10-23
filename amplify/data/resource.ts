import { a, defineData, type ClientSchema } from "@aws-amplify/backend";
import { placeOrder } from "../functions/place-order/resource";
import { modon } from "../functions/modon/resource";

// Orders live in DynamoDB (one table, managed by Amplify).
//
// Who can do what:
//   - A customer can only READ their own orders (the "owner" field), and
//     read/edit their own CustomerProfile.
//   - The ADMINS group (ÉLUE team) can read and update every order. Customers
//     can never change an order: changes go through the team.
//   - Nobody creates orders directly: the placeOrder function checks the
//     cart, prices it from our own product list, saves it, then tells Telegram.
//     The team can also place an order for a customer (placeOrder with customerPhone).
//   - Team-only fields (cashier number, who created/edited) are hidden from customers.

const schema = a
  .schema({
    OrderStatus: a.enum(["NEW", "CONFIRMED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"]),

    OrderItem: a.customType({
      slug: a.string().required(),
      nameAr: a.string().required(),
      nameEn: a.string().required(),
      qty: a.integer().required(),
      price: a.integer().required(),
    }),

    Order: a
      .model({
        orderNumber: a.string().required(),
        phone: a.string().required(),
        name: a.string().required(),
        province: a.string(),
        area: a.string(),
        address: a.string().required(),
        note: a.string(),
        source: a.string(),
        items: a.ref("OrderItem").required().array().required(),
        jars: a.integer().required(),
        total: a.integer().required(),
        status: a.ref("OrderStatus").required(),
        telegramSent: a.boolean(),
        // Number of the same order in the cashier system, typed in by the team.
        cashierOrderId: a.string().authorization((allow) => [allow.group("ADMINS")]),
        // Team member's WhatsApp number when the team placed the order for the customer.
        createdBy: a.string().authorization((allow) => [allow.group("ADMINS")]),
        // Last team member who changed the order (details or status), and when.
        editedBy: a.string().authorization((allow) => [allow.group("ADMINS")]),
        editedAt: a.datetime().authorization((allow) => [allow.group("ADMINS")]),
        // Customer already paid for the jars (e.g. Qi transfer); the driver
        // then collects only the delivery fee. `paid` is readable by the customer
        // (so their order shows it); the note is team only.
        paid: a.boolean(), // inherits model auth: owner read, team read/write
        paidNote: a.string().authorization((allow) => [allow.group("ADMINS")]), // how it was paid (e.g. Qi)
        // Modon Express (delivery). Set by the modon function; team only.
        modonId: a.string().authorization((allow) => [allow.group("ADMINS")]), // Modon's id (webhook, bulk lookup)
        modonQr: a.string().authorization((allow) => [allow.group("ADMINS")]), // Modon's order number (qr_id: edit, delete, sticker)
        modonLink: a.string().authorization((allow) => [allow.group("ADMINS")]), // sticker PDF
        modonPrice: a.integer().authorization((allow) => [allow.group("ADMINS")]), // what the driver collects
        modonFee: a.integer().authorization((allow) => [allow.group("ADMINS")]), // Modon's delivery fee
        modonStatusId: a.string().authorization((allow) => [allow.group("ADMINS")]),
        modonStatus: a.string().authorization((allow) => [allow.group("ADMINS")]),
        modonNote: a.string().authorization((allow) => [allow.group("ADMINS")]), // driver's problem note
        modonRegionId: a.integer().authorization((allow) => [allow.group("ADMINS")]),
        modonRegionName: a.string().authorization((allow) => [allow.group("ADMINS")]),
        modonSentAt: a.datetime().authorization((allow) => [allow.group("ADMINS")]),
        modonUpdatedAt: a.datetime().authorization((allow) => [allow.group("ADMINS")]),
        owner: a.string().authorization((allow) => [allow.ownerDefinedIn("owner").to(["read"]), allow.group("ADMINS")]),
      })
      // Fast lookups: a customer's orders, and orders by phone number (admin search).
      .secondaryIndexes((index) => [index("owner"), index("phone"), index("modonId")])
      .authorization((allow) => [allow.ownerDefinedIn("owner").to(["read"]), allow.group("ADMINS")]),

    // The customer's saved delivery details ("معلوماتي" on /account).
    // One per customer; only they can read or change it, the team can read it.
    CustomerProfile: a
      .model({
        name: a.string().required(),
        province: a.string().required(),
        area: a.string().required(),
        address: a.string().required(),
        owner: a.string().authorization((allow) => [allow.owner().to(["read", "delete"]), allow.group("ADMINS").to(["read"])]),
      })
      .authorization((allow) => [allow.owner(), allow.group("ADMINS").to(["read"])]),

    // Stock switch per flavor, set by the team on /admin. No row = available.
    // Everyone can read it (the shop shows «نفدت الكمية»); only ADMINS change it.
    ProductSetting: a
      .model({
        slug: a.string().required(),
        available: a.boolean().required(),
      })
      .identifier(["slug"])
      .authorization((allow) => [allow.publicApiKey().to(["read"]), allow.group("ADMINS")]),

    PlaceOrderResult: a.customType({
      id: a.string().required(),
      orderNumber: a.string().required(),
      createdAt: a.string().required(),
      telegramSent: a.boolean().required(),
    }),

    placeOrder: a
      .mutation()
      .arguments({
        name: a.string().required(),
        province: a.string().required(),
        area: a.string().required(),
        address: a.string().required(),
        note: a.string(),
        source: a.string(),
        items: a.json().required(),
        // Team only: place the order for this customer (WhatsApp number).
        customerPhone: a.string(),
        cashierOrderId: a.string(),
        // Team only: customer already paid for the jars (driver collects delivery only).
        paid: a.boolean(),
        paidNote: a.string(),
      })
      .returns(a.ref("PlaceOrderResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(placeOrder)),

    // Modon actions from the admin: regions, send, update, delete, refresh.
    modon: a
      .mutation()
      .arguments({
        action: a.string().required(),
        orderId: a.string(),
        cityId: a.integer(),
        regionId: a.integer(),
        regionName: a.string(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.group("ADMINS")])
      .handler(a.handler.function(modon)),
  })
  .authorization((allow) => [allow.resource(placeOrder), allow.resource(modon)]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
    // Public read of ProductSetting only. Amplify API keys last up to 365 days:
    // to renew, redeploy after changing expiresInDays (the shop treats a
    // failed read as "available", and orders are still checked on the server).
    apiKeyAuthorizationMode: { expiresInDays: 365 },
  },
});
