FROM node:11-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./
COPY meniga-client/package*.json ./meniga-client/

RUN npm --prefix ./meniga-client install ./meniga-client

RUN npm install
# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source
COPY . .

EXPOSE 3333
CMD [ "npm", "start" ]
