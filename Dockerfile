# Usa la versión LTS de Node.js
FROM node:20-slim

# Instalar dependencias necesarias para descargar e instalar gog
RUN apt-get update && apt-get install -y curl ca-certificates && rm -rf /var/lib/apt/lists/*

# Descargar e instalar el binario 'gog' de Linux (64-bit)
# (Suponiendo que es la CLI 'gog' v0.11.0 de Google Workspace)
RUN curl -L https://github.com/muesli/gog/releases/download/v0.11.0/gog_0.11.0_linux_amd64.tar.gz | tar xz -C /usr/local/bin gog

# Crear carpeta de la app
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar todo el código (excepto el .env, .git, etc.)
COPY . .

# Compilar TypeScript
RUN npm run build

# Comando para iniciar el bot
CMD ["npm", "run", "start"]
