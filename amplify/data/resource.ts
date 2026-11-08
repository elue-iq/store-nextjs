import { a, defineData, type ClientSchema } from "@aws-amplify/backend";
import { placeOrder } from "../functions/place-order/resource";
import { modon } from "../functions/modon/resource";
import { boxy } from "../functions/boxy/resource";
import { eatix } from "../functions/eatix/resource";
import { dispatch } from "../functions/dispatch/resource";
import { submitReview } from "../functions/submit-review/resource";
import { courierApp } from "../functions/courier-app/resource";

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
        phone2: a.string(), // optional second phone number (9647XXXXXXXXX)
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
        // Boxy (delivery). Set by the boxy function; team only.
        boxyUid: a.string().authorization((allow) => [allow.group("ADMINS")]), // Boxy's order uid (status, edit, cancel, label)
        boxyCode: a.string().authorization((allow) => [allow.group("ADMINS")]), // BXO-… number printed on the label
        boxyLink: a.string().authorization((allow) => [allow.group("ADMINS")]), // tracking page
        boxyFee: a.integer().authorization((allow) => [allow.group("ADMINS")]),
        boxyStatus: a.string().authorization((allow) => [allow.group("ADMINS")]), // Boxy status slug
        boxyStatusTitle: a.string().authorization((allow) => [allow.group("ADMINS")]),
        boxyNote: a.string().authorization((allow) => [allow.group("ADMINS")]),
        boxyRegionId: a.integer().authorization((allow) => [allow.group("ADMINS")]),
        boxyRegionName: a.string().authorization((allow) => [allow.group("ADMINS")]),
        // false = Boxy refused cooled delivery to this area, so it went without cooling. Team only.
        boxyCooled: a.boolean().authorization((allow) => [allow.group("ADMINS")]),
        boxySentAt: a.datetime().authorization((allow) => [allow.group("ADMINS")]),
        boxyUpdatedAt: a.datetime().authorization((allow) => [allow.group("ADMINS")]),
        boxyEvents: a.json().authorization((allow) => [allow.group("ADMINS")]), // webhook notifications for this order
        // Who delivers: MODON, or LOCAL = one of our own couriers (the Courier model), who gets
        // the order on Telegram. Team only.
        courierKind: a.string().authorization((allow) => [allow.group("ADMINS")]),
        courierId: a.string().authorization((allow) => [allow.group("ADMINS")]),
        courierName: a.string().authorization((allow) => [allow.group("ADMINS")]), // name when assigned
        // When the team received this order's cash from the local courier (courier settlement).
        courierSettledAt: a.string().authorization((allow) => [allow.group("ADMINS")]),
        courierSentAt: a.datetime().authorization((allow) => [allow.group("ADMINS")]),
        courierStatus: a.string().authorization((allow) => [allow.group("ADMINS")]), // SENT | FAILED
        courierError: a.string().authorization((allow) => [allow.group("ADMINS")]),
        // Delivery problems reported to the courier / Modon support: [{at, by, kind, text, to, via, ok}]
        issues: a.json().authorization((allow) => [allow.group("ADMINS")]),
        // The customer reviewed this delivered order (set by submitReview). Readable by the customer.
        reviewed: a.boolean(),
        reviewedAt: a.datetime(),
        // When the team last asked the customer for a review on WhatsApp, and how many times. Team only.
        reviewRequestedAt: a.datetime().authorization((allow) => [allow.group("ADMINS")]),
        reviewRequests: a.integer().authorization((allow) => [allow.group("ADMINS")]),
        // Coupons and credit (see lib/coupons.ts). total = subtotal - discount - creditUsed.
        subtotal: a.integer(), // jars before any discount (null on orders without one)
        discount: a.integer(), // the coupon's discount on the jars
        couponCode: a.string(),
        couponLabel: a.string(), // what the customer sees, e.g. «خصم 10%»
        coupon: a.json().authorization((allow) => [allow.group("ADMINS")]), // the coupon's rule when it was used
        cashback: a.integer(), // credit the customer earns once this order is delivered
        creditUsed: a.integer(), // credit from earlier cashback spent on this order
        // Affiliate campaign that brought the order (link or its coupon), and the sponsor's commission. Team only.
        campaignId: a.string().authorization((allow) => [allow.group("ADMINS")]),
        campaignSlug: a.string().authorization((allow) => [allow.group("ADMINS")]),
        sponsorId: a.string().authorization((allow) => [allow.group("ADMINS")]),
        commission: a.integer().authorization((allow) => [allow.group("ADMINS")]),
        commissionPaidAt: a.string().authorization((allow) => [allow.group("ADMINS")]),
        // The customer accepted the Baghdad delivery window (6–10 pm, else next day).
        slotAccepted: a.boolean().authorization((allow) => [allow.group("ADMINS")]),
        // Baghdad delivery period the customer picked: open | eve | night (see lib/delivery-slot.ts),
        // and the day they asked for (YYYY-MM-DD, empty = earliest). Printed on the courier label.
        deliverySlot: a.string(),
        deliveryDate: a.string(),
        // Qi Card online payment: Qi's payment id (team only) and its state
        // (CREATED = waiting for the customer to pay, SUCCESS, FAILED). The customer can read the state.
        qiPaymentId: a.string().authorization((allow) => [allow.group("ADMINS")]),
        qiStatus: a.string(),
        // Eatix (cashier device copy of the order). Team only.
        eatixId: a.string().authorization((allow) => [allow.group("ADMINS")]),
        eatixStatus: a.string().authorization((allow) => [allow.group("ADMINS")]), // SENT | SIMULATED | FAILED | OFF | CANCELLED
        eatixError: a.string().authorization((allow) => [allow.group("ADMINS")]),
        eatixSentAt: a.datetime().authorization((allow) => [allow.group("ADMINS")]),
        owner: a.string().authorization((allow) => [allow.ownerDefinedIn("owner").to(["read"]), allow.group("ADMINS")]),
      })
      // Fast lookups: a customer's orders, and orders by phone number (admin search).
      .secondaryIndexes((index) => [index("owner"), index("phone"), index("modonId"), index("qiPaymentId")])
      .authorization((allow) => [allow.ownerDefinedIn("owner").to(["read"]), allow.group("ADMINS")]),

    // A customer's review of a delivered order: one per order (the order number is the key,
    // so a second one is refused). Shown to everyone exactly as written: nobody (not even the
    // team) can edit or delete it from the app. Created only by submitReview.
    Review: a
      .model({
        orderNumber: a.string().required(),
        delivery: a.integer().required(), // 1–5
        taste: a.integer().required(), // 1–5
        comment: a.string(),
        firstName: a.string().required(),
        flavors: a.string().array(),
        jars: a.integer(),
        // Who delivered it (Modon or the courier's name), for comparing delivery companies. Team only.
        deliveredBy: a.string().authorization((allow) => [allow.group("ADMINS")]),
        phone: a.string().authorization((allow) => [allow.group("ADMINS")]),
        owner: a.string().authorization((allow) => [allow.group("ADMINS")]),
      })
      .identifier(["orderNumber"])
      .authorization((allow) => [allow.publicApiKey().to(["read"]), allow.group("ADMINS").to(["read"])]),

    // A local delivery company / courier. The bot sends the orders assigned to it, and
    // delivery-problem reports, to its Telegram chat (a channel or group the bot is in).
    Courier: a
      .model({
        name: a.string().required(),
        telegramChatId: a.string().required(), // -100… or @channelname
        // The courier's own WhatsApp number (9647XXXXXXXXX): they log in on /courier with it,
        // see only the orders given to them, and mark them in delivery / delivered.
        phone: a.string(),
        active: a.boolean(),
        note: a.string(),
      })
      .authorization((allow) => [allow.group("ADMINS")]),

    // A discount code (see lib/coupons.ts for the rules). The code is the key. Team only:
    // customers check a code through the «quote» query, which never lists codes.
    Coupon: a
      .model({
        code: a.string().required(), // UPPERCASE letters/digits
        title: a.string(), // internal note: what it is for
        kind: a.string().required(), // PERCENT | FIXED | FREE_DELIVERY | FREE_JARS | CASHBACK
        value: a.integer(), // PERCENT/CASHBACK: percent; FIXED: IQD
        maxDiscount: a.integer(), // PERCENT/CASHBACK: cap in IQD
        buyQty: a.integer(), // FREE_JARS: buy this many…
        freeQty: a.integer(), // …get this many free
        minJars: a.integer(),
        startsAt: a.datetime(),
        endsAt: a.datetime(),
        maxUses: a.integer(), // all customers together (orders placed)
        perCustomer: a.integer(), // per customer (default 1)
        firstOrderOnly: a.boolean(),
        active: a.boolean(),
        campaignId: a.string(), // an affiliate campaign's code: orders using it count for that campaign
      })
      .identifier(["code"])
      .authorization((allow) => [allow.group("ADMINS")]),

    // An affiliate (influencer, partner…) who promotes ÉLUE for a commission. Team only.
    Sponsor: a
      .model({
        name: a.string().required(),
        phone: a.string(), // 9647XXXXXXXXX: their own orders earn no commission
        instagram: a.string(),
        note: a.string(),
        active: a.boolean(),
      })
      .authorization((allow) => [allow.group("ADMINS")]),

    // One promotion by a sponsor: its own link (?ref=slug), dates, coupon and commission per jar. Team only.
    Campaign: a
      .model({
        sponsorId: a.string().required(),
        name: a.string().required(),
        slug: a.string().required(), // the link code: elue-iq.com/?ref=slug
        startsAt: a.datetime(),
        endsAt: a.datetime(),
        couponCode: a.string(), // applied automatically to visitors from the link
        commissionPerJar: a.integer(), // IQD per paid jar of a delivered order
        active: a.boolean(),
        note: a.string(),
      })
      .authorization((allow) => [allow.group("ADMINS")]),

    // Every notification Boxy sends to our webhook (written by the boxy function). Team only.
    BoxyEvent: a
      .model({
        at: a.datetime().required(),
        kind: a.string(), // the event / trigger name Boxy sent, as received
        orderNumber: a.string(), // ours (EL-…) when we could match it
        boxyCode: a.string(),
        title: a.string(),
        detail: a.string(),
        raw: a.string(), // the payload as received (trimmed)
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
      // Online payment: where to send the customer to pay (Qi Card).
      payUrl: a.string(),
    }),

    QiConfirmResult: a.customType({
      orderNumber: a.string().required(),
      status: a.string().required(), // CREATED | SUCCESS | FAILED
      paid: a.boolean().required(),
    }),

    placeOrder: a
      .mutation()
      .arguments({
        name: a.string().required(),
        province: a.string().required(),
        area: a.string().required(),
        address: a.string().required(),
        note: a.string(),
        phone2: a.string(), // optional second phone number (any Iraqi format)
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
        // Baghdad only: delivery period (open | eve | night) and the wanted day (YYYY-MM-DD).
        deliverySlot: a.string(),
        deliveryDate: a.string(),
        // The customer pays now with Qi Card instead of cash to the driver.
        payOnline: a.boolean(),
        // Discount code, and the affiliate campaign the customer came from (?ref=…).
        couponCode: a.string(),
        ref: a.string(),
      })
      .returns(a.ref("PlaceOrderResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(placeOrder)),

    // After the customer comes back from Qi's page: asks Qi what happened to the payment
    // (the signed notification does the same, this is the safety net) and updates the order.
    qiConfirm: a
      .mutation()
      .arguments({ orderNumber: a.string().required() })
      .returns(a.ref("QiConfirmResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(placeOrder)),

    // The customer's review of a delivered order (checked on the server: their own, delivered, not reviewed yet).
    // Prices a cart on the server: coupon, credit, delivery. Used by the checkout as the
    // customer types a code. Signed-in customers also get their credit and personal limits.
    quote: a
      .query()
      // phone: the team pricing an order for this customer (ignored for anyone else).
      .arguments({ items: a.json().required(), couponCode: a.string(), ref: a.string(), province: a.string(), phone: a.string() })
      .returns(a.json())
      .authorization((allow) => [allow.publicApiKey(), allow.authenticated()])
      .handler(a.handler.function(placeOrder)),

    // A visitor arrived from an affiliate link (?ref=slug): counts the visit and returns the
    // campaign's coupon so the checkout can apply it. Never returns commissions or sponsors.
    campaignVisit: a
      .mutation()
      .arguments({ ref: a.string().required() })
      .returns(a.json())
      .authorization((allow) => [allow.publicApiKey(), allow.authenticated()])
      .handler(a.handler.function(placeOrder)),

    // Admin: visits per campaign link.
    campaignStats: a
      .query()
      .arguments({ slugs: a.string().array().required() })
      .returns(a.json())
      .authorization((allow) => [allow.group("ADMINS")])
      .handler(a.handler.function(placeOrder)),

    submitReview: a
      .mutation()
      .arguments({
        orderNumber: a.string().required(),
        delivery: a.integer().required(),
        taste: a.integer().required(),
        comment: a.string(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(submitReview)),

    // The local courier's app (/courier): their orders, and in delivery / delivered. Checked on the
    // server: the caller's WhatsApp number must belong to an active courier, and the order to them.
    courierApp: a
      .mutation()
      .arguments({
        action: a.string().required(), // mine | get | status
        orderNumber: a.string(),
        status: a.string(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(courierApp)),

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

    // Boxy actions from the admin: regions, send, update, cancel, label, refresh.
    boxy: a
      .mutation()
      .arguments({
        action: a.string().required(),
        orderId: a.string(),
        province: a.string(),
        regionId: a.integer(),
        regionName: a.string(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.group("ADMINS")])
      .handler(a.handler.function(boxy)),

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
  .authorization((allow) => [allow.resource(placeOrder), allow.resource(modon), allow.resource(boxy), allow.resource(eatix), allow.resource(dispatch), allow.resource(submitReview), allow.resource(courierApp)]);

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
