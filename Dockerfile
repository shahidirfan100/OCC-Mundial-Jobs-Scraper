# Patchright-compatible Chrome image. Patchright is Playwright-compatible and
# uses the Chromium build shipped with this image.
FROM apify/actor-node-playwright-chrome:22-1.64.1

RUN npm ls apify patchright || true

COPY --chown=myuser:myuser package*.json Dockerfile ./

RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version \
    && rm -r ~/.npm

COPY --chown=myuser:myuser . ./

ENV APIFY_LOG_LEVEL=INFO

CMD npm start --silent
