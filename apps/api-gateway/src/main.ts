import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as fs from 'fs';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: [
        process.env.FRONTEND_URL || 'http://localhost:3000',
        'http://localhost:5173', // Vite dev server
        'http://127.0.0.1:5173', // Vite dev server (IP)
        'http://127.0.0.1:3000', // Vite dev server (IP)
        'http://localhost:19006', // Expo web
        'http://localhost:8081', // Expo dev server
        /^http:\/\/192\.168\.\d+\.\d+:\d+$/, // Local network IPs (physical devices)
        /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/, // Local network IPs (10.x.x.x)
      ],
      credentials: true,
    },
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // API prefix
  app.setGlobalPrefix('api/v1');

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('WineOps AI API')
    .setDescription(`
## Overview

Real-time API for Restaurant Wine Inventory & Procurement Management.

### Features

- **Dashboard Aggregation**: Single endpoint for all dashboard data (API Bus pattern)
- **One-Tap Actions**: Quick approval workflows for managers
- **Toast POS Integration**: Proxy endpoints for Toast API
- **Real-time Updates**: WebSocket support for live data sync
- **Rate Limiting**: Per-user and per-restaurant quotas

### Authentication

All endpoints (except public ones) require a Bearer token in the Authorization header.

\`\`\`
Authorization: Bearer <your-jwt-token>
\`\`\`

### Rate Limits

| Endpoint Type | Limit | Window |
|--------------|-------|--------|
| Default | 100 | 60s |
| Auth | 10 | 60s |
| Upload | 10 | 300s |
| AI | 20 | 60s |

### WebSocket Events

Connect to \`ws://localhost:4000\` and join rooms:
- \`restaurant:{restaurantId}\` - Restaurant-wide events
- \`user:{userId}\` - User-specific events

Events:
- \`notification\` - New notifications
- \`inventory_update\` - Inventory changes
- \`order_update\` - Order status changes
- \`one_tap_action\` - One-tap action updates
    `)
    .setVersion('1.0.0')
    .setContact('WineOps Team', 'https://wineops.ai', 'support@wineops.ai')
    .setLicense('Proprietary', 'https://wineops.ai/license')
    .addServer('http://localhost:4000', 'Development')
    .addServer('https://api.wineops.ai', 'Production')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT token',
      },
      'JWT-auth',
    )
    .addTag('dashboard', 'Aggregated dashboard endpoints (API Bus pattern)')
    .addTag('one-tap-actions', 'One-tap action management')
    .addTag('toast', 'Toast POS API integration')
    .addTag('auth', 'Authentication & Authorization')
    .addTag('inventory', 'Inventory Management')
    .addTag('procurement', 'Procurement & Orders')
    .addTag('notifications', 'Real-time Notifications')
    .addTag('reports', 'Reports & Analytics')
    .addTag('websocket', 'WebSocket Events')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  
  // Export OpenAPI spec to file (for CI/CD and external tools)
  if (process.env.NODE_ENV !== 'production') {
    fs.writeFileSync('./openapi.json', JSON.stringify(document, null, 2));
    console.log('📄 OpenAPI spec exported to openapi.json');
  }
  
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'WineOps AI API Documentation',
    customfavIcon: '/favicon.ico',
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info { margin: 20px 0 }
      .swagger-ui .info .title { font-size: 2em }
    `,
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      showRequestDuration: true,
    },
  });

  // Start server
  const port = process.env.PORT || 4000;
  await app.listen(port);

  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🍷 WineOps AI - API Gateway                            ║
║                                                          ║
║   🚀 Server running on http://localhost:${port}            ║
║   📚 Swagger docs: http://localhost:${port}/api/docs        ║
║   🔌 WebSocket: ws://localhost:${port}                     ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);
}

bootstrap();

