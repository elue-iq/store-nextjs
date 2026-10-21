import { a, defineData, type ClientSchema } from "@aws-amplify/backend";
import { placeOrder } from "../functions/place-order/resource";

// Orders live in DynamoDB (one table, managed by Amplify).
//
// Who can do what:
//   - A customer can only READ their own orders (the "owner" field).
//   - The ADMINS group (ÉLUE team) can read and update every order.
//   - Nobody creates orders directly: the placeOrder function checks the
//     cart, prices it from our own product list, saves it, then tells Telegram.

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
        address: a.string().required(),
        note: a.string(),
        source: a.string(),
        items: a.ref("OrderItem").required().array().required(),
        jars: a.integer().required(),
        total: a.integer().required(),
        status: a.ref("OrderStatus").required(),
        telegramSent: a.boolean(),
        owner: a.string().authorization((allow) => [allow.ownerDefinedIn("owner").to(["read"]), allow.group("ADMINS")]),
      })
      // Fast lookups: a customer's orders, and orders by phone number (admin search).
      .secondaryIndexes((index) => [index("owner"), index("phone")])
      .authorization((allow) => [allow.ownerDefinedIn("owner").to(["read"]), allow.group("ADMINS")]),

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
        address: a.string().required(),
        note: a.string(),
        source: a.string(),
        items: a.json().required(),
      })
      .returns(a.ref("PlaceOrderResult"))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(placeOrder)),
  })
  .authorization((allow) => [allow.resource(placeOrder)]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
