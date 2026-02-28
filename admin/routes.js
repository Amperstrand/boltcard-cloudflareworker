import { handleAdminCards } from './handlers.js';
import { handleAdminGetCard } from './handlers.js';
import { handleAdminCreateCard } from './handlers.js';
import { handleAdminUpdateCard } from './handlers.js';
import { handleAdminBackends } from './handlers.js';
import { handleAdminUpdateBackend, handleAdminCreateBackend } from './handlers.js';

export function setupAdminRoutes(router) {
  // Cards endpoints
  router.get('/admin/cards', handleAdminCards);
  router.get('/admin/cards/:uid', handleAdminGetCard);
  router.post('/admin/cards', handleAdminCreateCard);
  router.patch('/admin/cards/:uid', handleAdminUpdateCard);

  // Backends endpoints
  router.get('/admin/backends', handleAdminBackends);
  router.post('/admin/backends', handleAdminCreateBackend);
  router.patch('/admin/backends/:id', handleAdminUpdateBackend);
}
