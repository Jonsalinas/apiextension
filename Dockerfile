# Imagen ligera de Node
FROM node:18-slim

# Carpeta de trabajo
WORKDIR /app

# Copiar solo dependencias primero (mejor cache)
COPY package*.json ./

# Instalar dependencias
RUN npm install --omit=dev

# Copiar el resto del proyecto
COPY . .

# Cloud Run usa puerto 8080
ENV PORT=8080

EXPOSE 8080

# Ejecutar la API
CMD ["node", "server.js"]
