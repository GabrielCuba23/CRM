FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 CRM_DB_PATH=/data/crm.sqlite3
COPY requirements.txt .
COPY build-wheels/ /wheels/
ARG INSTALL_FROM_WHEELS=0
RUN if [ "$INSTALL_FROM_WHEELS" = "1" ]; then pip install --no-cache-dir --no-index --find-links=/wheels -r requirements.txt; else pip install --no-cache-dir -r requirements.txt; fi
RUN rm -rf /wheels && useradd --create-home --uid 10001 crm && mkdir /data && chown crm:crm /data
COPY --chown=crm:crm backend ./backend
COPY --chown=crm:crm index.html styles.css app.js crm.mjs icons.svg login.html login.js ./
USER crm
EXPOSE 8000
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "2", "--access-logfile", "/dev/null", "backend.wsgi:app"]
