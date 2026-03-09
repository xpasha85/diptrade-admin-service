import Ajv from 'ajv';

import { sendError } from '../http/errors.js';
import { createPayloadSchemas } from '../openapi/payloadSchemas.js';

const ajv = new Ajv({
  allErrors: true,
  coerceTypes: true,
  allowUnionTypes: true
});

const schemas = createPayloadSchemas();

function formatAjvErrors(errors = []) {
  const messages = [];

  for (const err of errors) {
    if (err.keyword === 'required') {
      messages.push(`${err.params?.missingProperty || 'field'} is required`);
      continue;
    }

    const path = err.instancePath
      ? err.instancePath.slice(1).replace(/\//g, '.')
      : 'payload';

    messages.push(`${path} ${err.message || 'is invalid'}`.trim());
  }

  return messages.join('; ') || 'payload is invalid';
}

function makePayloadValidator(schema) {
  const validate = ajv.compile(schema);

  return (req, res, next) => {
    const payload = req.body ?? {};

    if (validate(payload)) {
      req.body = payload;
      return next();
    }

    return sendError(res, 400, 'VALIDATION_FAILED', formatAjvErrors(validate.errors));
  };
}

export const validateCreateCarPayload = makePayloadValidator(schemas.createCarPayload);
export const validateUpdateCarPayload = makePayloadValidator(schemas.updateCarPayload);
export const validateBulkDeletePayload = makePayloadValidator(schemas.bulkDeletePayload);
export const validateReorderPhotosPayload = makePayloadValidator(schemas.reorderPhotosPayload);
