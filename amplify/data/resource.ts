import { a, defineData, type ClientSchema } from "@aws-amplify/backend";
import { placeOrder } from "../functions/place-order/resource";
import { modon } from "../functions/modon/resource";
import { eatix } from "../functions/eatix/resource";
import { dispatch } from "../functions/dispatch/resource";

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
        // How the customer paid in advance (jars and/or delivery fee): QI | ZAINCASH | OTHER,
        // or GIFT when ÉLUE gave the jars free. payRef = the transaction / transfer
        // number (required for QI, ZAINCASH and OTHER). Team only; no method = cash to the driver.
        payMethod: a.string().authorization((allow) => [allow.group("ADMINS")]),
        payRef: a.string().authorization((allow) => [allow.group("ADMINS")]),
        // ÉLUE covers the delivery fee (free delivery as a gift / offer); the driver
        // then collects only the jars. Readable by the customer so their order shows it.
        freeDelivery: a.boolean(),
        // The customer already paid the delivery fee (card, transfer…); the driver
        // then collects only the jars. Not a cost to ÉLUE (unlike freeDelivery).
        deliveryPaid: a.boolean(),
        // Delivery tracking for the customer (from the courier's status updates,
        // in our own wording): current line, expected arrival, and the steps so far.
        // Written only by the modon function; the customer can read them.
        trackStatus: a.string(),
        trackEta: a.datetime(),
        trackEvents: a.json(),
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
        // Who delivers: MODON, or LOCAL = one of our own couriers (the Courier model), who gets
        // the order on Telegram. Team only.
        courierKind: a.string().authorization((allow) => [allow.group("ADMINS")]),
        courierId: a.string().authorization((allow) => [allow.group("ADMINS")]),
        courierName: a.string().authorization((allow) => [allow.group("ADMINS")]), // name when assigned
        courierSentAt: a.datetime().authorization((allow) => [allow.group("ADMINS")]),
        courierStatus: a.string().authorization((allow) => [allow.group("ADMINS")]), // SENT | FAILED
        courierError: a.string().authorization((allow) => [allow.group("ADMINS")]),
        // Delivery problems reported to the courier / Modon support: [{at, by, kind, text, to, via, ok}]
        issues: a.json().authorization((allow) => [allow.group("ADMINS")]),
        // The customer accepted the Baghdad delivery window (6–10 pm, else next day).
        slotAccepted: a.boolean().authorization((allow) => [allow.group("ADMINS")]),
        // Eatix (cashier device copy of the order). Team only.
        eatixId: a.string().authorization((allow) => [allow.group("ADMINS")]),
        eatixStatus: a.string().authorization((allow) => [allow.group("ADMINS")]), // SENT | SIMULATED | FAILED | OFF | CANCELLED
        eatixError: a.string().authorization((allow) => [allow.group("ADMINS")]),
        eatixSentAt: a.datetime().authorization((allow) => [allow.group("ADMINS")]),
        owner: a.string().authorization((allow) => [allow.ownerDefinedIn("owner").to(["read"]), allow.group("ADMINS")]),
      })
      // Fast lookups: a customer's orders, and orders by phone number (admin search).
      .secondaryIndexes((index) => [index("owner"), index("phone"), index("modonId")])
      .authorization((allow) => [allow.ownerDefinedIn("owner").to(["read"]), allow.group("ADMINS")]),

    // A local delivery company / courier. The bot sends the orders assigned to it, and
    // delivery-problem reports, to its Telegram chat (a channel or group the bot is in).
    Courier: a
      .model({
        name: a.string().required(),
        telegramChatId: a.string().required(), // -100… or @channelname
        active: a.boolean(),
        note: a.string(),
      })
      .authorization((allow) => [allow.group("ADMINS")]),

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
        // Team only: ÉLUE covers the delivery (driver collects jars only).
        freeDelivery: a.boolean(),
        // Team only: customer already paid the delivery fee (driver collects jars only).
        deliveryPaid: a.boolean(),
        // Team only: how it was paid in advance (QI | ZAINCASH | OTHER | GIFT) and its number.
        payMethod: a.string(),
        payRef: a.string(),
        // The customer accepted the Baghdad delivery window.
        slotAccepted: a.boolean(),
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

    // Local couriers (Telegram) from the admin: assign / resend / unassign an order,
    // report a delivery problem, test a chat, cancel notice.
    dispatch: a
      .mutation()
      .arguments({
        action: a.string().required(),
        orderId: a.string(),
        courierId: a.string(),
        chatId: a.string(),
        kind: a.string(),
        text: a.string(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.group("ADMINS")])
      .handler(a.handler.function(dispatch)),

    // Eatix actions from the admin: send (again), cancel.
    eatix: a
      .mutation()
      .arguments({ action: a.string().required(), orderId: a.string() })
      .returns(a.json())
      .authorization((allow) => [allow.group("ADMINS")])
      .handler(a.handler.function(eatix)),
  })
  .authorization((allow) => [allow.resource(placeOrder), allow.resource(modon), allow.resource(eatix), allow.resource(dispatch)]);

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
