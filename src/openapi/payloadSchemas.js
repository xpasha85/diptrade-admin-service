export const COUNTRY_CODES = ['KR', 'CN', 'RU'];

export function createPayloadSchemas(currentYear = new Date().getFullYear()) {
  const nonEmptyString = {
    type: 'string',
    minLength: 1,
    pattern: '\\S'
  };

  const numericYear = {
    type: 'number',
    minimum: 1900,
    maximum: currentYear + 1
  };

  const nonNegativeNumber = {
    type: 'number',
    minimum: 0
  };

  const createCarPayload = {
    type: 'object',
    required: ['brand', 'model', 'year', 'price', 'country'],
    properties: {
      brand: nonEmptyString,
      model: nonEmptyString,
      year: numericYear,
      price: nonNegativeNumber,
      country: {
        type: 'string',
        enum: COUNTRY_CODES
      }
    },
    additionalProperties: true
  };

  const updateCarPayload = {
    type: 'object',
    properties: {
      brand: nonEmptyString,
      model: nonEmptyString,
      year: numericYear,
      price: nonNegativeNumber,
      country: {
        type: 'string',
        enum: COUNTRY_CODES
      }
    },
    additionalProperties: true
  };

  const bulkDeletePayload = {
    type: 'object',
    required: ['ids'],
    properties: {
      ids: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'number'
        }
      }
    },
    additionalProperties: true
  };

  const reorderPhotosPayload = {
    type: 'object',
    required: ['photos'],
    properties: {
      photos: {
        type: 'array',
        items: {
          type: 'string',
          minLength: 1
        }
      }
    },
    additionalProperties: true
  };

  return {
    createCarPayload,
    updateCarPayload,
    bulkDeletePayload,
    reorderPhotosPayload
  };
}
