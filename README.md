# medusa-mondialrelay

[![npm version](https://img.shields.io/npm/v/medusa-mondialrelay.svg)](https://www.npmjs.com/package/medusa-mondialrelay)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A **Medusa v2** fulfillment provider plugin for [Mondial Relay](https://www.mondialrelay.fr/) shipping services. Supports both Point Relais (pickup point) and Home Delivery options with real-time pricing via [@frontboi/mondial-relay](https://www.npmjs.com/package/@frontboi/mondial-relay).

## Features

- 🏪 **Point Relais** - Pickup point delivery with interactive selector
- 🏠 **Home Delivery** - Door-to-door delivery (+3€ surcharge)
- 💰 **Real Pricing** - Uses official Mondial Relay pricing via `@frontboi/mondial-relay`
- 🌍 **Multi-country** - FR, BE, LU, NL, ES, PT, DE, IT, AT
- 🏷️ **Label Generation** - PDF shipping label creation
- 📦 **Shipment Tracking** - Tracking number generation
- 🖨️ **Admin Widget** - Print labels directly from order details
- 🔄 **Dual API Support** - Compatible SOAP v1 (previous users) et REST v2 (new users)

## Requirements

- **Medusa v2.0+**
- **Node.js 18+**
- **Mondial Relay API credentials** (contact Mondial Relay for API access)

## Installation

```bash
npm install medusa-mondialrelay
```

## Configuration

### 1. Add the plugin to medusa-config.ts

Since 2024, Mondial Relay provides REST v2 credentials in the format `login@business-api.mondialrelay.com`. If you received this type of login, add `useRestApi: true` to your config to use the REST API instead of the legacy SOAP API.

```typescript
// medusa-config.ts
import { loadEnv, defineConfig } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

export default defineConfig({
  // ... other config
  modules: [
    {
      resolve: "@medusajs/medusa/fulfillment",
      options: {
        providers: [
          {
            resolve: "medusa-mondialrelay/providers/mondialrelay",
            id: "mondialrelay-fulfillment",
            options: {
              useRestApi: true,  
              login: process.env.MONDIAL_RELAY_LOGIN,
              password: process.env.MONDIAL_RELAY_PASSWORD,
              customerId: process.env.MONDIAL_RELAY_CUSTOMER_ID,
              culture: process.env.MONDIAL_RELAY_CULTURE || "fr-FR",
              piBaseUrl: process.env.MONDIAL_RELAY_API_URL || "https://api.mondialrelay.com/Web_Services.asmx",
              businessAddress: {
                title: "M",
                firstname: process.env.BUSINESS_FIRSTNAME,
                lastname: process.env.BUSINESS_LASTNAME,
                streetname: process.env.BUSINESS_STREET,
                countryCode: process.env.BUSINESS_COUNTRY || "FR",
                postCode: process.env.BUSINESS_POSTCODE,
                city: process.env.BUSINESS_CITY,
                email: process.env.BUSINESS_EMAIL,
                mobileNo: process.env.BUSINESS_PHONE,
              },
            },
          },
        ],
      },
    },
  ],
})
```

### 2. Environment Variables

Create or update your `.env` file:

```env
# Mondial Relay API Credentials
MONDIAL_RELAY_LOGIN=your_login
MONDIAL_RELAY_PASSWORD=your_password
MONDIAL_RELAY_CUSTOMER_ID=your_customer_id
MONDIAL_RELAY_CULTURE=fr-FR
MONDIAL_RELAY_API_URL=https://api.mondialrelay.com/Web_Services.asmx

# Business Address (sender)
BUSINESS_FIRSTNAME=John
BUSINESS_LASTNAME=Doe
BUSINESS_STREET=123 Main Street
BUSINESS_POSTCODE=75001
BUSINESS_CITY=Paris
BUSINESS_COUNTRY=FR
BUSINESS_EMAIL=contact@yourstore.com
BUSINESS_PHONE=0612345678
```

### 3. Create Shipping Options

In the Medusa Admin, create shipping options:

#### Point Relais Option
1. Go to **Settings → Locations & Shipping**
2. Select your location and add a shipping option
3. Set:
   - **Name**: `Mondial Relay - Point Relais`
   - **Price Type**: `Calculated`
   - **Fulfillment Provider**: `mondialrelay-fulfillment`

#### Home Delivery Option
1. Create another shipping option
2. Set:
   - **Name**: `Mondial Relay - Livraison à Domicile`
   - **Price Type**: `Calculated`
   - **Fulfillment Provider**: `mondialrelay-fulfillment`

> **Note**: The plugin detects home delivery by looking for "domicile" in the option name.

## Pricing

### Real-time Pricing via @frontboi/mondial-relay

The plugin uses [`@frontboi/mondial-relay`](https://www.npmjs.com/package/@frontboi/mondial-relay) for official Mondial Relay pricing based on:
- **Package weight** (250g to 30kg)
- **Destination country** (FR, BE, LU, NL, ES, PT, DE, IT, AT)

### Home Delivery Surcharge

Home delivery options automatically add a **+3€ surcharge** to the base Point Relais price.

### Example Prices (France)

| Weight | Point Relais | Home Delivery |
|--------|--------------|---------------|
| 500g   | ~3.99€       | ~6.99€        |
| 1kg    | ~4.49€       | ~7.49€        |
| 2kg    | ~5.49€       | ~8.49€        |
| 5kg    | ~7.99€       | ~10.99€       |

> Prices are fetched in real-time from Mondial Relay's official pricing grid.

## Storefront Integration

### Point Relais Selector

For Point Relais delivery, integrate a pickup point selector. The plugin expects:

```typescript
await setShippingMethod({
  cartId: cart.id,
  shippingMethodId: selectedOptionId,
  data: {
    shipping_option_name: "Mondial Relay - Point Relais",
    parcel_shop_id: "020340",
    parcel_shop_name: "Relay Shop Name",
    parcel_shop_address: "123 Shop Street",
    parcel_shop_city: "Paris",
    parcel_shop_postcode: "75001",
  }
})
```

### Recommended: @frontboi/mondial-relay

```bash
npm install @frontboi/mondial-relay
```

```tsx
import { ParcelShopSelector } from "@frontboi/mondial-relay"

<ParcelShopSelector
  postalCode="75001"
  countryCode="FR"
  brandIdAPI={process.env.NEXT_PUBLIC_MONDIAL_RELAY_BRAND_ID}
  onParcelShopSelected={(shop) => {
    // Handle selection
  }}
/>
```

### Home Delivery

```typescript
await setShippingMethod({
  cartId: cart.id,
  shippingMethodId: selectedOptionId,
  data: {
    shipping_option_name: "Mondial Relay - Livraison à Domicile",
  }
})
```

## Admin Features

### Label Printing Widget

The plugin adds a widget to the order details page for:
- ✅ Tracking number display
- ✅ Pickup point info (if applicable)
- 🖨️ "Print Label" button for PDF download

## Supported Countries

| Code | Country |
|------|---------|
| FR | France |
| BE | Belgium |
| LU | Luxembourg |
| NL | Netherlands |
| ES | Spain |
| PT | Portugal |
| DE | Germany |
| IT | Italy |
| AT | Austria |

## License

MIT © [Théo Daguier](https://github.com/theodaguier)

## Links

- � [NPM Package](https://www.npmjs.com/package/medusa-mondialrelay)
- � [GitHub Repository](https://github.com/theodaguier/medusa-mondialrelay)
- 📧 Contact: theo.daguier@icloud.com
