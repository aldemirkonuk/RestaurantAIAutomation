
#!/bin/bash

echo "🔍 WineOps AI Health Check"
echo "=========================="

# Test PostgreSQL
echo -n "PostgreSQL: "
if docker exec wineops-postgres pg_isready -U wineops > /dev/null 2>&1; then
    echo "✅ Running"
else
    echo "❌ Not responding"
fi

# Test Redis
echo -n "Redis: "
REDIS_RESULT=$(docker exec wineops-redis redis-cli ping 2>/dev/null)
if [ "$REDIS_RESULT" = "PONG" ]; then
    echo "✅ Running"
else
    echo "❌ Not responding"
fi

# Test RabbitMQ
echo -n "RabbitMQ: "
RABBIT_RESULT=$(curl -s -u wineops:wineops_secret http://localhost:15672/api/healthchecks/node 2>/dev/null)
if echo "$RABBIT_RESULT" | grep -q '"status":"ok"'; then
    echo "✅ Running"
else
    echo "❌ Not responding or auth failed"
fi

# Test pgAdmin
echo -n "pgAdmin: "
PGADMIN_RESULT=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5050 2>/dev/null)
if [ "$PGADMIN_RESULT" = "200" ] || [ "$PGADMIN_RESULT" = "302" ]; then
    echo "✅ Running"
else
    echo "❌ Not responding"
fi

echo ""
echo "=========================="
echo "Service URLs:"
echo "  pgAdmin:     http://localhost:5050"
echo "  RabbitMQ UI: http://localhost:15672"