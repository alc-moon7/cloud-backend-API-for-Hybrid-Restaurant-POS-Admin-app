import swaggerJSDoc from 'swagger-jsdoc';

import { env } from '../config/env.js';

const orderStatuses = [
  'pending',
  'accepted',
  'preparing',
  'ready',
  'served',
  'cancelled',
];

const syncStatuses = ['synced', 'pending', 'failed'];

const errorResponses = {
  400: { $ref: '#/components/responses/BadRequest' },
  401: { $ref: '#/components/responses/Unauthorized' },
  404: { $ref: '#/components/responses/NotFound' },
  500: { $ref: '#/components/responses/InternalServerError' },
};

const bearerSecurity = [{ bearerAuth: [] }];

const outletParam = { $ref: '#/components/parameters/OutletId' };
const idempotencyHeader = { $ref: '#/components/parameters/IdempotencyKey' };
const sinceQuery = { $ref: '#/components/parameters/SinceQuery' };

const openApiDefinition = {
  openapi: '3.0.3',
  info: {
    title: 'Hybrid POS Cloud Backend API',
    version: '1.0.0',
    description:
      'Express + PostgreSQL API for Hybrid Restaurant POS Admin menu, orders, devices, sync, and realtime workflows.',
  },
  servers: [
    {
      url: `http://localhost:${env.port}`,
      description: 'Local Express development server',
    },
  ],
  tags: [
    { name: 'Health', description: 'API and database status' },
    { name: 'Devices', description: 'Admin device registration and heartbeat' },
    { name: 'Menu', description: 'Outlet menu management and customer menu reads' },
    { name: 'Orders', description: 'Order creation, listing, tracking, and status changes' },
    { name: 'Sync', description: 'Offline-first sync pull and push contracts' },
    { name: 'Realtime', description: 'WebSocket realtime channel' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'device-token',
        description:
          'Required when DEVICE_API_TOKEN is configured. Send Authorization: Bearer <token>.',
      },
    },
    parameters: {
      OutletId: {
        name: 'outletId',
        in: 'path',
        required: true,
        schema: { type: 'string', example: 'outlet_001' },
        description: 'Outlet identifier used to scope menu, orders, and sync data.',
      },
      MenuItemId: {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string', example: 'menu_burger_001' },
        description: 'Menu item id.',
      },
      OrderId: {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string', example: 'ord_001' },
        description: 'Order id.',
      },
      SinceQuery: {
        name: 'since',
        in: 'query',
        required: false,
        schema: { type: 'string', format: 'date-time' },
        description: 'Only return records changed at or after this timestamp.',
      },
      IdempotencyKey: {
        name: 'Idempotency-Key',
        in: 'header',
        required: false,
        schema: { type: 'string', example: 'order-ord_001' },
        description:
          'Optional idempotency key for write operations. Reusing the key returns the original stored response.',
      },
    },
    responses: {
      BadRequest: {
        description: 'Validation or request error.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
            example: {
              ok: false,
              error: 'Validation failed.',
              details: {
                fieldErrors: {
                  outletId: ['Required'],
                },
              },
            },
          },
        },
      },
      Unauthorized: {
        description: 'Bearer token is missing or invalid when DEVICE_API_TOKEN is configured.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
            example: { ok: false, error: 'Unauthorized.' },
          },
        },
      },
      NotFound: {
        description: 'Requested route or resource was not found.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
            example: { ok: false, error: 'Order was not found.' },
          },
        },
      },
      InternalServerError: {
        description: 'Unexpected server or database error.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
            example: { ok: false, error: 'Internal server error.' },
          },
        },
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        required: ['ok', 'error'],
        properties: {
          ok: { type: 'boolean', example: false },
          error: { type: 'string', example: 'Validation failed.' },
          details: {
            description: 'Optional validation or database details.',
            nullable: true,
          },
        },
      },
      HealthResponse: {
        type: 'object',
        required: ['ok', 'server', 'mode', 'database', 'timestamp'],
        properties: {
          ok: { type: 'boolean', example: true },
          server: { type: 'string', example: 'hybrid-pos-cloud' },
          mode: { type: 'string', example: 'cloud' },
          database: { type: 'boolean', example: true },
          wsPath: { type: 'string', example: '/ws/admin' },
          connectedWsClients: { type: 'integer', example: 0 },
          latencyMs: { type: 'integer', example: 8 },
          timestamp: {
            type: 'string',
            format: 'date-time',
            example: '2026-05-04T08:30:00.000Z',
          },
        },
      },
      DeviceRegistrationRequest: {
        type: 'object',
        required: ['serverId', 'restaurantId', 'outletId', 'restaurantName', 'outletName'],
        properties: {
          serverId: { type: 'string', example: 'device_abc123' },
          restaurantId: { type: 'string', example: 'rest_001' },
          outletId: { type: 'string', example: 'outlet_001' },
          restaurantName: { type: 'string', example: 'Moon Bistro' },
          outletName: { type: 'string', example: 'Main Outlet' },
        },
      },
      DeviceHeartbeatRequest: {
        type: 'object',
        required: ['serverId', 'restaurantId', 'outletId'],
        properties: {
          serverId: { type: 'string', example: 'device_abc123' },
          restaurantId: { type: 'string', example: 'rest_001' },
          outletId: { type: 'string', example: 'outlet_001' },
          localIp: { type: 'string', nullable: true, example: '192.168.0.10' },
          port: { type: 'integer', nullable: true, example: 8080 },
          localServerRunning: { type: 'boolean', nullable: true, example: false },
          timestamp: {
            type: 'string',
            format: 'date-time',
            example: '2026-05-04T08:30:00.000Z',
          },
        },
      },
      Device: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'device_abc123' },
          restaurant_id: { type: 'string', example: 'rest_001' },
          outlet_id: { type: 'string', example: 'outlet_001' },
          restaurant_name: { type: 'string', example: 'Moon Bistro' },
          outlet_name: { type: 'string', example: 'Main Outlet' },
          local_ip: { type: 'string', nullable: true, example: '192.168.0.10' },
          local_port: { type: 'integer', nullable: true, example: 8080 },
          local_server_running: { type: 'boolean', example: false },
          last_heartbeat_at: { type: 'string', format: 'date-time', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      DeviceResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
          data: { $ref: '#/components/schemas/Device' },
        },
      },
      MenuItem: {
        type: 'object',
        required: ['id', 'name', 'description', 'category', 'price', 'isAvailable'],
        properties: {
          id: { type: 'string', example: 'menu_chicken_burger' },
          name: { type: 'string', example: 'Chicken Burger' },
          description: { type: 'string', example: 'Crispy chicken with house sauce.' },
          category: { type: 'string', example: 'Burgers' },
          price: { type: 'number', format: 'double', example: 8.5 },
          imageUrl: {
            type: 'string',
            nullable: true,
            example: 'https://cdn.example.com/menu/chicken-burger.jpg',
          },
          isAvailable: { type: 'boolean', example: true },
          preparationTimeMinutes: { type: 'integer', nullable: true, example: 12 },
          tags: {
            type: 'array',
            items: { type: 'string' },
            example: ['popular', 'spicy'],
          },
          syncStatus: { type: 'string', enum: syncStatuses, example: 'synced' },
          version: { type: 'integer', example: 1 },
          deletedAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      MenuItemInput: {
        allOf: [{ $ref: '#/components/schemas/MenuItem' }],
      },
      MenuListResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
          count: { type: 'integer', example: 1 },
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/MenuItem' },
          },
        },
      },
      MenuItemResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
          data: { $ref: '#/components/schemas/MenuItem' },
        },
      },
      OrderItem: {
        type: 'object',
        required: ['id', 'orderId', 'menuItemId', 'name', 'qty', 'price', 'lineTotal'],
        properties: {
          id: { type: 'string', example: 'item_001' },
          orderId: { type: 'string', example: 'ord_001' },
          menuItemId: { type: 'string', example: 'menu_chicken_burger' },
          name: { type: 'string', example: 'Chicken Burger' },
          qty: { type: 'integer', example: 2 },
          price: { type: 'number', format: 'double', example: 8.5 },
          lineTotal: { type: 'number', format: 'double', example: 17 },
        },
      },
      OrderItemInput: {
        type: 'object',
        required: ['menuItemId', 'qty'],
        properties: {
          id: { type: 'string', example: 'item_001' },
          orderId: { type: 'string', example: 'ord_001' },
          menuItemId: { type: 'string', example: 'menu_chicken_burger' },
          name: {
            type: 'string',
            example: 'Chicken Burger',
            description:
              'Optional. If omitted, the server loads the available menu item by menuItemId.',
          },
          qty: { type: 'integer', minimum: 1, example: 2 },
          price: { type: 'number', format: 'double', example: 8.5 },
          lineTotal: { type: 'number', format: 'double', example: 17 },
        },
      },
      Order: {
        type: 'object',
        required: ['id', 'orderNo', 'source', 'status', 'total', 'items'],
        properties: {
          id: { type: 'string', example: 'ord_001' },
          orderNo: { type: 'string', example: 'ORD-260504083000-AB12CD34' },
          source: { type: 'string', example: 'cloud' },
          customerName: { type: 'string', nullable: true, example: 'Moon Ahmed' },
          tableNo: { type: 'string', nullable: true, example: 'A4' },
          note: { type: 'string', nullable: true, example: 'No onions' },
          status: { type: 'string', enum: orderStatuses, example: 'pending' },
          total: { type: 'number', format: 'double', example: 17 },
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/OrderItem' },
          },
          syncStatus: { type: 'string', enum: syncStatuses, example: 'synced' },
          version: { type: 'integer', example: 1 },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      OrderInput: {
        type: 'object',
        required: ['items'],
        properties: {
          id: { type: 'string', example: 'ord_001' },
          orderNo: { type: 'string', example: 'WEB-001' },
          source: { type: 'string', example: 'cloud_customer' },
          customerName: { type: 'string', nullable: true, example: 'Moon Ahmed' },
          tableNo: { type: 'string', nullable: true, example: 'A4' },
          note: { type: 'string', nullable: true, example: 'No onions' },
          status: { type: 'string', enum: orderStatuses, example: 'pending' },
          total: { type: 'number', format: 'double', example: 17 },
          items: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/components/schemas/OrderItemInput' },
          },
          syncStatus: { type: 'string', enum: syncStatuses, example: 'synced' },
          version: { type: 'integer', example: 1 },
          createdAt: { type: 'string', format: 'date-time', nullable: true },
          updatedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      OrderListResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
          count: { type: 'integer', example: 1 },
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/Order' },
          },
        },
      },
      OrderResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
          data: { $ref: '#/components/schemas/Order' },
        },
      },
      OrderStatusUpdate: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: orderStatuses, example: 'preparing' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SyncEvent: {
        type: 'object',
        required: ['id', 'entityType', 'entityId', 'action'],
        properties: {
          id: { type: 'string', example: 'sync_001' },
          entityType: {
            type: 'string',
            example: 'menu_item',
            description: 'Supported: menu_item, order, order_status.',
          },
          entityId: { type: 'string', example: 'menu_chicken_burger' },
          action: {
            type: 'string',
            example: 'update',
            description: 'Supported actions depend on entityType.',
          },
          payload: {
            type: 'object',
            additionalProperties: true,
            example: {
              id: 'menu_chicken_burger',
              name: 'Chicken Burger',
              price: 8.5,
            },
          },
          payloadJson: { type: 'string', example: '{"status":"ready"}' },
          status: { type: 'string', enum: syncStatuses, example: 'pending' },
          retryCount: { type: 'integer', example: 0 },
          lastError: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time', nullable: true },
          updatedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      SyncPushRequest: {
        oneOf: [
          { $ref: '#/components/schemas/SyncEvent' },
          {
            type: 'object',
            required: ['events'],
            properties: {
              events: {
                type: 'array',
                items: { $ref: '#/components/schemas/SyncEvent' },
              },
            },
          },
        ],
      },
      SyncPushResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
          count: { type: 'integer', example: 1 },
          data: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              example: {
                eventId: 'sync_001',
                entityType: 'menu_item',
                data: { id: 'menu_chicken_burger', name: 'Chicken Burger' },
              },
            },
          },
        },
      },
      SyncPullResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              menu: {
                type: 'array',
                items: { $ref: '#/components/schemas/MenuItem' },
              },
              orders: {
                type: 'array',
                items: { $ref: '#/components/schemas/Order' },
              },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
      RealtimeEvent: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: [
              'device_registered',
              'device_heartbeat',
              'menu_updated',
              'order_created',
              'order_status_updated',
            ],
            example: 'order_created',
          },
          data: { type: 'object', additionalProperties: true },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Check API and database health',
        security: [],
        responses: {
          200: {
            description: 'API and database are available.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
              },
            },
          },
          503: {
            description: 'Database unavailable.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
                example: {
                  ok: false,
                  server: 'hybrid-pos-cloud',
                  mode: 'cloud',
                  database: false,
                  error: 'Database unavailable.',
                  timestamp: '2026-05-04T08:30:00.000Z',
                },
              },
            },
          },
        },
      },
    },
    '/devices/register': {
      post: {
        tags: ['Devices'],
        summary: 'Register or update an Admin device',
        security: bearerSecurity,
        parameters: [idempotencyHeader],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/DeviceRegistrationRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'Device registered.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DeviceResponse' },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    '/devices/heartbeat': {
      post: {
        tags: ['Devices'],
        summary: 'Send Admin device heartbeat',
        security: bearerSecurity,
        parameters: [idempotencyHeader],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/DeviceHeartbeatRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'Heartbeat recorded.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DeviceResponse' },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    '/outlets/{outletId}/menu': {
      get: {
        tags: ['Menu'],
        summary: 'List menu items for an outlet',
        security: bearerSecurity,
        parameters: [
          outletParam,
          {
            name: 'includeUnavailable',
            in: 'query',
            required: false,
            schema: { type: 'boolean', default: false },
            description: 'When true, include unavailable items. Deleted items are always hidden.',
          },
          sinceQuery,
        ],
        responses: {
          200: {
            description: 'Menu list.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MenuListResponse' },
              },
            },
          },
          ...errorResponses,
        },
      },
      post: {
        tags: ['Menu'],
        summary: 'Create or upsert a menu item',
        security: bearerSecurity,
        parameters: [outletParam, idempotencyHeader],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/MenuItemInput' },
            },
          },
        },
        responses: {
          200: {
            description: 'Menu item upserted.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MenuItemResponse' },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    '/outlets/{outletId}/menu/{id}': {
      patch: {
        tags: ['Menu'],
        summary: 'Patch a menu item',
        security: bearerSecurity,
        parameters: [outletParam, { $ref: '#/components/parameters/MenuItemId' }, idempotencyHeader],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/MenuItemInput' },
              example: {
                name: 'Chicken Burger',
                price: 9.25,
                isAvailable: true,
                updatedAt: '2026-05-04T08:30:00.000Z',
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Menu item updated.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MenuItemResponse' },
              },
            },
          },
          ...errorResponses,
        },
      },
      delete: {
        tags: ['Menu'],
        summary: 'Soft delete a menu item',
        security: bearerSecurity,
        parameters: [outletParam, { $ref: '#/components/parameters/MenuItemId' }, idempotencyHeader],
        responses: {
          200: {
            description: 'Menu item soft deleted and marked unavailable.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MenuItemResponse' },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    '/outlets/{outletId}/orders': {
      get: {
        tags: ['Orders'],
        summary: 'List orders for an outlet',
        security: bearerSecurity,
        parameters: [
          outletParam,
          sinceQuery,
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: orderStatuses },
            description: 'Filter by order status.',
          },
          {
            name: 'source',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'cloud' },
            description: 'Filter by order source.',
          },
        ],
        responses: {
          200: {
            description: 'Order list.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OrderListResponse' },
              },
            },
          },
          ...errorResponses,
        },
      },
      post: {
        tags: ['Orders'],
        summary: 'Create or upsert an order',
        security: bearerSecurity,
        parameters: [outletParam, idempotencyHeader],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/OrderInput' },
            },
          },
        },
        responses: {
          201: {
            description: 'Order created.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OrderResponse' },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    '/outlets/{outletId}/orders/{id}': {
      get: {
        tags: ['Orders'],
        summary: 'Get one order by id',
        security: bearerSecurity,
        parameters: [outletParam, { $ref: '#/components/parameters/OrderId' }],
        responses: {
          200: {
            description: 'Order details.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OrderResponse' },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    '/outlets/{outletId}/orders/{id}/status': {
      patch: {
        tags: ['Orders'],
        summary: 'Update order status',
        description:
          'Status priority is enforced. Served orders cannot be downgraded, and cancelled can override only before served.',
        security: bearerSecurity,
        parameters: [outletParam, { $ref: '#/components/parameters/OrderId' }, idempotencyHeader],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/OrderStatusUpdate' },
            },
          },
        },
        responses: {
          200: {
            description: 'Order status updated.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OrderResponse' },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    '/outlets/{outletId}/sync/pull': {
      get: {
        tags: ['Sync'],
        summary: 'Pull cloud changes for an outlet',
        security: bearerSecurity,
        parameters: [outletParam, sinceQuery],
        responses: {
          200: {
            description: 'Menu and order changes.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SyncPullResponse' },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    '/outlets/{outletId}/sync/push': {
      post: {
        tags: ['Sync'],
        summary: 'Push one or more local sync events',
        security: bearerSecurity,
        parameters: [outletParam, idempotencyHeader],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SyncPushRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'Sync events applied.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SyncPushResponse' },
              },
            },
          },
          ...errorResponses,
        },
      },
    },
    '/ws/admin': {
      get: {
        tags: ['Realtime'],
        summary: 'Admin realtime WebSocket',
        description:
          'Connect with ws://localhost:4000/ws/admin. Messages are JSON objects shaped like RealtimeEvent.',
        security: bearerSecurity,
        responses: {
          101: {
            description: 'WebSocket protocol upgrade.',
          },
          ...errorResponses,
        },
      },
    },
  },
};

export const openApiSpec = swaggerJSDoc({
  definition: openApiDefinition,
  apis: ['src/**/*.routes.ts', 'dist/**/*.routes.js'],
});
