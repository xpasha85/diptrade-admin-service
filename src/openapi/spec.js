import { COUNTRY_CODES, createPayloadSchemas } from './payloadSchemas.js';

const SORT_VALUES = [
  'id_asc',
  'id_desc',
  'price_asc',
  'price_desc',
  'year_asc',
  'year_desc',
  'added_at_asc',
  'added_at_desc',
  'newest',
  'cheap',
  'expensive',
  'year_new'
];

const STATUS_VALUES = ['active', 'featured', 'auction', 'stock', 'sold', 'hidden', 'all'];

function queryParam(name, schema, description) {
  return {
    in: 'query',
    name,
    required: false,
    schema,
    description
  };
}

function boolOrNumberStringSchema() {
  return {
    type: 'string',
    enum: ['1', '0', 'true', 'false', 'yes', 'no', 'on', 'off']
  };
}

export function createOpenApiSpec({ serverUrl } = {}) {
  const payloadSchemas = createPayloadSchemas();

  return {
    openapi: '3.0.3',
    info: {
      title: 'admin-service API',
      version: '1.0.0',
      description: 'Admin API for cars catalog management and photo operations.'
    },
    servers: serverUrl ? [{ url: serverUrl }] : undefined,
    tags: [
      { name: 'system', description: 'Service health and API docs' },
      { name: 'cars', description: 'Cars catalog operations' },
      { name: 'photos', description: 'Car photo operations' }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer'
        }
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          required: ['error', 'message'],
          properties: {
            error: { type: 'string' },
            message: { type: 'string' }
          }
        },
        HealthResponse: {
          type: 'object',
          required: ['status', 'uptime'],
          properties: {
            status: { type: 'string', enum: ['ok'] },
            uptime: { type: 'number' }
          }
        },
        Car: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'number' },
            brand: { type: 'string' },
            model: { type: 'string' },
            year: { type: 'number' },
            price: { type: 'number' },
            country: { type: 'string', enum: COUNTRY_CODES },
            photos: {
              type: 'array',
              items: { type: 'string' }
            },
            assets_folder: { type: 'string' }
          }
        },
        CarResponse: {
          type: 'object',
          required: ['car'],
          properties: {
            car: { $ref: '#/components/schemas/Car' }
          }
        },
        CarsListResponse: {
          type: 'object',
          required: ['cars'],
          properties: {
            cars: {
              type: 'array',
              items: { $ref: '#/components/schemas/Car' }
            }
          }
        },
        Pagination: {
          type: 'object',
          required: ['page', 'per_page', 'total', 'total_pages', 'has_prev', 'has_next'],
          properties: {
            page: { type: 'number' },
            per_page: { type: 'number' },
            total: { type: 'number' },
            total_pages: { type: 'number' },
            has_prev: { type: 'boolean' },
            has_next: { type: 'boolean' }
          }
        },
        CarsListWithPaginationResponse: {
          type: 'object',
          required: ['cars', 'pagination'],
          properties: {
            cars: {
              type: 'array',
              items: { $ref: '#/components/schemas/Car' }
            },
            pagination: { $ref: '#/components/schemas/Pagination' }
          }
        },
        OkResponse: {
          type: 'object',
          required: ['ok'],
          properties: {
            ok: { type: 'boolean', enum: [true] }
          }
        },
        BulkDeleteResponse: {
          type: 'object',
          required: ['ok', 'deleted'],
          properties: {
            ok: { type: 'boolean', enum: [true] },
            deleted: { type: 'number' }
          }
        },
        CreateCarPayload: payloadSchemas.createCarPayload,
        UpdateCarPayload: payloadSchemas.updateCarPayload,
        BulkDeletePayload: payloadSchemas.bulkDeletePayload,
        ReorderPhotosPayload: payloadSchemas.reorderPhotosPayload
      }
    },
    paths: {
      '/openapi.json': {
        get: {
          tags: ['system'],
          summary: 'Get OpenAPI specification',
          responses: {
            200: {
              description: 'OpenAPI document',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: true
                  }
                }
              }
            }
          }
        }
      },
      '/health': {
        get: {
          tags: ['system'],
          summary: 'Service health check',
          responses: {
            200: {
              description: 'Service is healthy',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthResponse' }
                }
              }
            }
          }
        }
      },
      '/cars': {
        get: {
          tags: ['cars'],
          summary: 'List cars with optional filters and pagination',
          parameters: [
            queryParam('q', { type: 'string' }, 'Free-text search query'),
            queryParam('country', { type: 'string', enum: COUNTRY_CODES }, 'Country code alias for country_code'),
            queryParam('country_code', { type: 'string', enum: COUNTRY_CODES }, 'Country code'),
            queryParam('status', { type: 'string', enum: STATUS_VALUES }, 'Status filter'),
            queryParam('brand', { type: 'string' }, 'Brand substring'),
            queryParam('model', { type: 'string' }, 'Model substring'),
            queryParam('price_from', { type: 'number' }, 'Minimal price'),
            queryParam('price_to', { type: 'number' }, 'Maximal price'),
            queryParam('year_from', { type: 'number' }, 'Minimal year'),
            queryParam('year_to', { type: 'number' }, 'Maximal year'),
            queryParam('volume_from', { type: 'number' }, 'Minimal engine volume'),
            queryParam('volume_to', { type: 'number' }, 'Maximal engine volume'),
            queryParam('hp_from', { type: 'number' }, 'Minimal horsepower'),
            queryParam('hp_to', { type: 'number' }, 'Maximal horsepower'),
            queryParam('fuel', { type: 'string' }, 'Fuel value; supports repeated and CSV values'),
            queryParam('in_stock', boolOrNumberStringSchema(), 'Boolean-like flag'),
            queryParam('is_auction', boolOrNumberStringSchema(), 'Boolean-like flag'),
            queryParam('full_time', boolOrNumberStringSchema(), 'Boolean-like flag'),
            queryParam('featured', boolOrNumberStringSchema(), 'Boolean-like flag'),
            queryParam('is_visible', boolOrNumberStringSchema(), 'Boolean-like flag'),
            queryParam('is_sold', boolOrNumberStringSchema(), 'Boolean-like flag'),
            queryParam('sort', { type: 'string', enum: SORT_VALUES }, 'Sorting option'),
            queryParam('page', { type: 'number', minimum: 1 }, 'Pagination page'),
            queryParam('per_page', { type: 'number', minimum: 1, maximum: 200 }, 'Pagination page size'),
            queryParam('page_size', { type: 'number', minimum: 1, maximum: 200 }, 'Alias for per_page'),
            queryParam('limit', { type: 'number', minimum: 1, maximum: 200 }, 'Alias for per_page')
          ],
          responses: {
            200: {
              description: 'Cars list',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      { $ref: '#/components/schemas/CarsListResponse' },
                      { $ref: '#/components/schemas/CarsListWithPaginationResponse' }
                    ]
                  }
                }
              }
            },
            400: {
              description: 'Validation failed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            }
          }
        },
        post: {
          tags: ['cars'],
          summary: 'Create a car',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateCarPayload' }
              }
            }
          },
          responses: {
            201: {
              description: 'Car created',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CarResponse' }
                }
              }
            },
            400: {
              description: 'Validation failed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            401: {
              description: 'Authorization header missing or invalid',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            403: {
              description: 'Admin token is invalid',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            }
          }
        }
      },
      '/cars/bulk-delete': {
        post: {
          tags: ['cars'],
          summary: 'Delete multiple cars by ids',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BulkDeletePayload' }
              }
            }
          },
          responses: {
            200: {
              description: 'Cars deleted',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/BulkDeleteResponse' }
                }
              }
            },
            400: {
              description: 'Validation failed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            401: {
              description: 'Authorization header missing or invalid',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            403: {
              description: 'Admin token is invalid',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            }
          }
        }
      },
      '/cars/{id}': {
        get: {
          tags: ['cars'],
          summary: 'Get one car by id',
          parameters: [
            {
              in: 'path',
              name: 'id',
              required: true,
              schema: { type: 'string' }
            }
          ],
          responses: {
            200: {
              description: 'Car found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CarResponse' }
                }
              }
            },
            404: {
              description: 'Car not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            }
          }
        },
        patch: {
          tags: ['cars'],
          summary: 'Update an existing car',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: 'path',
              name: 'id',
              required: true,
              schema: { type: 'string' }
            }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateCarPayload' }
              }
            }
          },
          responses: {
            200: {
              description: 'Car updated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CarResponse' }
                }
              }
            },
            400: {
              description: 'Validation failed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            401: {
              description: 'Authorization header missing or invalid',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            403: {
              description: 'Admin token is invalid',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            404: {
              description: 'Car not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            }
          }
        },
        delete: {
          tags: ['cars'],
          summary: 'Delete a car by id',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: 'path',
              name: 'id',
              required: true,
              schema: { type: 'string' }
            }
          ],
          responses: {
            200: {
              description: 'Car deleted',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/OkResponse' }
                }
              }
            },
            401: {
              description: 'Authorization header missing or invalid',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            403: {
              description: 'Admin token is invalid',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            404: {
              description: 'Car not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            }
          }
        }
      },
      '/cars/{id}/photos': {
        post: {
          tags: ['photos'],
          summary: 'Upload photos for a car',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: 'path',
              name: 'id',
              required: true,
              schema: { type: 'string' }
            }
          ],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['files'],
                  properties: {
                    files: {
                      type: 'array',
                      items: {
                        type: 'string',
                        format: 'binary'
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            201: {
              description: 'Photos uploaded',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CarResponse' }
                }
              }
            },
            400: {
              description: 'Validation failed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            401: {
              description: 'Authorization header missing or invalid',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            403: {
              description: 'Admin token is invalid',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            404: {
              description: 'Car not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            }
          }
        }
      },
      '/cars/{id}/photos/reorder': {
        patch: {
          tags: ['photos'],
          summary: 'Reorder car photos',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: 'path',
              name: 'id',
              required: true,
              schema: { type: 'string' }
            }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ReorderPhotosPayload' }
              }
            }
          },
          responses: {
            200: {
              description: 'Photos reordered',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CarResponse' }
                }
              }
            },
            400: {
              description: 'Validation failed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            401: {
              description: 'Authorization header missing or invalid',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            403: {
              description: 'Admin token is invalid',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            404: {
              description: 'Car not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            }
          }
        }
      },
      '/cars/{id}/photos/{name}': {
        delete: {
          tags: ['photos'],
          summary: 'Delete one photo from a car',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: 'path',
              name: 'id',
              required: true,
              schema: { type: 'string' }
            },
            {
              in: 'path',
              name: 'name',
              required: true,
              schema: { type: 'string' }
            }
          ],
          responses: {
            200: {
              description: 'Photo deleted',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CarResponse' }
                }
              }
            },
            400: {
              description: 'Validation failed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            401: {
              description: 'Authorization header missing or invalid',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            403: {
              description: 'Admin token is invalid',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            },
            404: {
              description: 'Car or photo not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' }
                }
              }
            }
          }
        }
      }
    }
  };
}
