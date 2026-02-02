const UPS_SANDBOX_URL = 'https://wwwcie.ups.com';
const UPS_PRODUCTION_URL = 'https://onlinetools.ups.com';

class UPSService {
  constructor() {
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  getBaseUrl() {
    return process.env.UPS_ENVIRONMENT === 'production'
      ? UPS_PRODUCTION_URL
      : UPS_SANDBOX_URL;
  }

  async getAccessToken() {
    // Return cached token if still valid (with 5 min buffer)
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry - 300000) {
      return this.accessToken;
    }

    const clientId = process.env.UPS_CLIENT_ID;
    const clientSecret = process.env.UPS_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('UPS credentials not configured');
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch(`${this.getBaseUrl()}/security/v1/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`
      },
      body: 'grant_type=client_credentials'
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get UPS token: ${error}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000);

    console.log('UPS token refreshed, expires in', data.expires_in, 'seconds');
    return this.accessToken;
  }

  async getRate(shipmentDetails) {
    const token = await this.getAccessToken();

    const requestBody = this.buildRateRequest(shipmentDetails);

    const response = await fetch(`${this.getBaseUrl()}/api/rating/v2409/Rate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'transId': `rate-${Date.now()}`,
        'transactionSrc': 'SmartFilterPro'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`UPS Rate API error: ${error}`);
    }

    return response.json();
  }

  async shopRates(shipmentDetails) {
    const token = await this.getAccessToken();

    const requestBody = this.buildRateRequest(shipmentDetails);

    // Shop endpoint returns all available service rates
    const response = await fetch(`${this.getBaseUrl()}/api/rating/v2409/Shop`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'transId': `shop-${Date.now()}`,
        'transactionSrc': 'SmartFilterPro'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`UPS Shop API error: ${error}`);
    }

    return response.json();
  }

  buildRateRequest(details) {
    const {
      shipFromPostalCode,
      shipFromStateCode,
      shipFromCountryCode = 'US',
      shipToPostalCode,
      shipToStateCode,
      shipToCountryCode = 'US',
      weight,
      weightUnit = 'LBS',
      length,
      width,
      height,
      dimensionUnit = 'IN',
      serviceCode = null // null = shop all services
    } = details;

    const request = {
      RateRequest: {
        Request: {
          SubVersion: '2403',
          TransactionReference: {
            CustomerContext: `Rate-${Date.now()}`
          }
        },
        Shipment: {
          ShipmentRatingOptions: {
            NegotiatedRatesIndicator: ''
          },
          Shipper: {
            ShipperNumber: process.env.UPS_ACCOUNT_NUMBER,
            Address: {
              PostalCode: shipFromPostalCode,
              StateProvinceCode: shipFromStateCode,
              CountryCode: shipFromCountryCode
            }
          },
          ShipTo: {
            Address: {
              PostalCode: shipToPostalCode,
              StateProvinceCode: shipToStateCode,
              CountryCode: shipToCountryCode
            }
          },
          ShipFrom: {
            Address: {
              PostalCode: shipFromPostalCode,
              StateProvinceCode: shipFromStateCode,
              CountryCode: shipFromCountryCode
            }
          },
          Package: {
            PackagingType: {
              Code: '02', // Customer supplied package
              Description: 'Package'
            },
            Dimensions: {
              UnitOfMeasurement: {
                Code: dimensionUnit
              },
              Length: String(length),
              Width: String(width),
              Height: String(height)
            },
            PackageWeight: {
              UnitOfMeasurement: {
                Code: weightUnit
              },
              Weight: String(weight)
            }
          }
        }
      }
    };

    // Add specific service if requested
    if (serviceCode) {
      request.RateRequest.Shipment.Service = {
        Code: serviceCode
      };
    }

    return request;
  }

  async createShipment(shipmentDetails) {
    const token = await this.getAccessToken();

    const requestBody = this.buildShipmentRequest(shipmentDetails);

    const response = await fetch(`${this.getBaseUrl()}/api/shipments/v2409/ship`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'transId': `ship-${Date.now()}`,
        'transactionSrc': 'SmartFilterPro'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`UPS Shipping API error: ${error}`);
    }

    return response.json();
  }

  buildShipmentRequest(details) {
    const {
      // Ship From (your warehouse)
      shipFromName,
      shipFromCompany,
      shipFromPhone,
      shipFromAddress,
      shipFromCity,
      shipFromStateCode,
      shipFromPostalCode,
      shipFromCountryCode = 'US',
      // Ship To (customer)
      shipToName,
      shipToCompany,
      shipToPhone,
      shipToAddress,
      shipToCity,
      shipToStateCode,
      shipToPostalCode,
      shipToCountryCode = 'US',
      // Package
      weight,
      weightUnit = 'LBS',
      length,
      width,
      height,
      dimensionUnit = 'IN',
      // Service
      serviceCode = '03', // Default to Ground
      // Label
      labelFormat = 'GIF' // GIF, PNG, PDF, ZPL
    } = details;

    return {
      ShipmentRequest: {
        Request: {
          SubVersion: '2403',
          RequestOption: 'nonvalidate',
          TransactionReference: {
            CustomerContext: `Ship-${Date.now()}`
          }
        },
        Shipment: {
          Description: 'Air Filters',
          Shipper: {
            Name: shipFromCompany || shipFromName,
            AttentionName: shipFromName,
            Phone: {
              Number: shipFromPhone
            },
            ShipperNumber: process.env.UPS_ACCOUNT_NUMBER,
            Address: {
              AddressLine: shipFromAddress,
              City: shipFromCity,
              StateProvinceCode: shipFromStateCode,
              PostalCode: shipFromPostalCode,
              CountryCode: shipFromCountryCode
            }
          },
          ShipTo: {
            Name: shipToCompany || shipToName,
            AttentionName: shipToName,
            Phone: {
              Number: shipToPhone
            },
            Address: {
              AddressLine: shipToAddress,
              City: shipToCity,
              StateProvinceCode: shipToStateCode,
              PostalCode: shipToPostalCode,
              CountryCode: shipToCountryCode
            }
          },
          ShipFrom: {
            Name: shipFromCompany || shipFromName,
            AttentionName: shipFromName,
            Phone: {
              Number: shipFromPhone
            },
            Address: {
              AddressLine: shipFromAddress,
              City: shipFromCity,
              StateProvinceCode: shipFromStateCode,
              PostalCode: shipFromPostalCode,
              CountryCode: shipFromCountryCode
            }
          },
          PaymentInformation: {
            ShipmentCharge: {
              Type: '01', // Transportation
              BillShipper: {
                AccountNumber: process.env.UPS_ACCOUNT_NUMBER
              }
            }
          },
          Service: {
            Code: serviceCode,
            Description: 'UPS Service'
          },
          Package: {
            Description: 'Air Filters',
            Packaging: {
              Code: '02', // Customer supplied package
              Description: 'Package'
            },
            Dimensions: {
              UnitOfMeasurement: {
                Code: dimensionUnit
              },
              Length: String(length),
              Width: String(width),
              Height: String(height)
            },
            PackageWeight: {
              UnitOfMeasurement: {
                Code: weightUnit
              },
              Weight: String(weight)
            }
          }
        },
        LabelSpecification: {
          LabelImageFormat: {
            Code: labelFormat
          },
          LabelStockSize: {
            Height: '6',
            Width: '4'
          }
        }
      }
    };
  }
}

module.exports = new UPSService();
