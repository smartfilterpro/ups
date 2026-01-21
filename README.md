# UPS Rating API Service

A simple Node.js service that wraps the UPS Rating API for shipping cost lookups.

## Setup

### 1. Clone and install

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in your UPS credentials:

```bash
cp .env.example .env
```

Get your credentials from [developer.ups.com](https://developer.ups.com):
- `UPS_CLIENT_ID` - Your OAuth client ID
- `UPS_CLIENT_SECRET` - Your OAuth client secret  
- `UPS_ACCOUNT_NUMBER` - Your UPS account number

### 3. Run locally

```bash
npm run dev
```

## Railway Deployment

1. Push to GitHub
2. Connect repo to Railway
3. Add environment variables in Railway dashboard:
   - `UPS_CLIENT_ID`
   - `UPS_CLIENT_SECRET`
   - `UPS_ACCOUNT_NUMBER`
   - `UPS_ENVIRONMENT=production`

Railway will auto-detect Node.js and deploy.

## API Endpoints

### Get Single Rate
`POST /api/ups/rate`

```json
{
  "shipFromPostalCode": "30301",
  "shipToPostalCode": "10001",
  "weight": 5,
  "length": 10,
  "width": 8,
  "height": 6,
  "serviceCode": "03"
}
```

### Shop All Rates
`POST /api/ups/shop`

```json
{
  "shipFromPostalCode": "30301",
  "shipToPostalCode": "10001",
  "weight": 5,
  "length": 10,
  "width": 8,
  "height": 6
}
```

Returns rates for all available services, sorted by price.

### List Service Codes
`GET /api/ups/services`

### Health Check
`GET /health`

## Service Codes

| Code | Service |
|------|---------|
| 01 | Next Day Air |
| 02 | 2nd Day Air |
| 03 | Ground |
| 12 | 3 Day Select |
| 13 | Next Day Air Saver |
| 14 | Next Day Air Early |
| 59 | 2nd Day Air A.M. |
| 65 | UPS Saver |
