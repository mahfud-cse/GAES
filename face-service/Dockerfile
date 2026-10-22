FROM python:3.12-slim
WORKDIR /srv/gaes-face
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home gaes
COPY engine.py server.py prepare_models.py ./
COPY models ./models
RUN python prepare_models.py
RUN mkdir /data && chown gaes:gaes /data
USER gaes
ENV GAES_FACE_BIND=0.0.0.0 GAES_FACE_PORT=8765 GAES_FACE_DATA_DIR=/data
EXPOSE 8765
CMD ["python", "server.py"]
