FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY solver.py server.py ./
ENV PORT=8765 OPTIMIZER_BIND=0.0.0.0
EXPOSE 8765
CMD ["python", "server.py"]
