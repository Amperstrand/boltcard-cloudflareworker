import { CardDO } from '../durableObjects/CardDO.js';
import { BackendRegistryDO } from '../durableObjects/BackendRegistryDO.js';
import { AdminDO } from '../durableObjects/AdminDO.js';

const ADMIN_KEY = 'admin-change-me-in-production';

function validateAdminKey(request) {
  const adminKey = request.headers.get('X-Admin-Key');
  return adminKey === ADMIN_KEY;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

export async function handleAdminCards(request, env) {
  if (!validateAdminKey(request)) {
    return errorResponse('Invalid admin key', 401);
  }

  const cardStub = env.CARD_OBJECTS.get(env.CARD_OBJECTS.idFromName('CardDO'));

  const url = new URL(request.url);
  const uid = url.pathname.split('/').pop();

  if (request.method === 'GET') {
    if (uid) {
      const card = await cardStub.getCard();
      if (card) {
        return jsonResponse({ card });
      }
      return errorResponse('Card not found', 404);
    }

    const cards = [];
    const list = await cardStub.list();
    for (const id of list.keys()) {
      const card = await cardStub.get(id);
      if (card) {
        const cardData = JSON.parse(card.card);
        cards.push(cardData);
      }
    }
    return jsonResponse({ cards });
  }

  return errorResponse('Method not allowed', 405);
}

export async function handleAdminGetCard(request, env) {
  if (!validateAdminKey(request)) {
    return errorResponse('Invalid admin key', 401);
  }

  const url = new URL(request.url);
  const uid = url.pathname.split('/').pop();

  const cardStub = env.CARD_OBJECTS.get(env.CARD_OBJECTS.idFromName('CardDO'));
  const cardRecord = await cardStub.getCard();
  
  if (!cardRecord) {
    return errorResponse('Card not found', 404);
  }

  const cardData = JSON.parse(cardRecord.card);
  const cardResponse = {
    uid,
    ...cardData,
    keys: {
      K0: cardData.keys_enc.K0,
      K1: cardData.keys_enc.K1,
      K2: cardData.keys_enc.K2,
      K3: cardData.keys_enc.K3,
      K4: cardData.keys_enc.K4
    }
  };

  return jsonResponse({ card: cardResponse });
}

export async function handleAdminCreateCard(request, env) {
  if (!validateAdminKey(request)) {
    return errorResponse('Invalid admin key', 401);
  }

  const body = await request.json();
  const { uid, backend } = body;

  if (!uid) {
    return errorResponse('UID is required', 400);
  }

  const cardStub = env.CARD_OBJECTS.get(env.CARD_OBJECTS.idFromName('CardDO'));
  await cardStub.createCard(uid, {
    uid,
    keys_enc: {
      K0: crypto.randomUUID(),
      K1: crypto.randomUUID(),
      K2: crypto.randomUUID(),
      K3: crypto.randomUUID(),
      K4: crypto.randomUUID()
    },
    counter: 0,
    status: 'active',
    backend: { primary: backend?.primary || 'default' },
    createdAt: new Date().toISOString()
  });

  return jsonResponse({ uid, status: 'created' }, 201);
}

export async function handleAdminUpdateCard(request, env) {
  if (!validateAdminKey(request)) {
    return errorResponse('Invalid admin key', 401);
  }

  const url = new URL(request.url);
  const uid = url.pathname.split('/').pop();
  const body = await request.json();

  const cardStub = env.CARD_OBJECTS.get(env.CARD_OBJECTS.idFromName('CardDO'));
  const cardRecord = await cardStub.getCard();

  if (!cardRecord) {
    return errorResponse('Card not found', 404);
  }

  await cardStub.updateCard(uid, {
    ...body,
    updatedAt: new Date().toISOString()
  });

  return jsonResponse({ uid, status: 'updated' });
}

export async function handleAdminBackends(request, env) {
  if (!validateAdminKey(request)) {
    return errorResponse('Invalid admin key', 401);
  }

  const backendStub = env.BACKEND_REGISTRY.get(env.BACKEND_REGISTRY.idFromName('BackendRegistryDO'));

  if (request.method === 'GET') {
    const backends = await backendStub.listBackends();
    return jsonResponse({ backends });
  }

  const body = await request.json();

  await backendStub.createBackend(body);
  return jsonResponse({ id: body.id, status: 'created' }, 201);
}

export async function handleAdminUpdateBackend(request, env) {
  if (!validateAdminKey(request)) {
    return errorResponse('Invalid admin key', 401);
  }

  const url = new URL(request.url);
  const backendId = url.pathname.split('/').pop();
  const body = await request.json();

  const backendStub = env.BACKEND_REGISTRY.get(env.BACKEND_REGISTRY.idFromName('BackendRegistryDO'));
  await backendStub.updateBackend(backendId, body);

  return jsonResponse({ id: backendId, status: 'updated' });
}
