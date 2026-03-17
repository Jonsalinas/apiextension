FROM node:18

# Crear carpeta de trabajo
WORKDIR /app

# Copiar package.json
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar todo el proyecto
COPY . .

# Puerto que usa Cloud Run
ENV PORT=8080

EXPOSE 8080

# Ejecutar la API
CMD ["npm", "start"]
