## Kubernetes deployment

This option runs the app on a Kubernetes cluster using a Deployment, Service, and Ingress.

### Files

- `Dockerfile` — builds a production image suitable for Kubernetes
- `pvc.yaml` — `PersistentVolumeClaim` for JSON caches under `/data` (PostgreSQL is external or separate)
- `deployment.yaml` — `Deployment` with 2 replicas and health probes
- `service.yaml` — `ClusterIP` service exposing the app on port 80 inside the cluster
- `ingress.yaml` — example `Ingress` routing HTTP traffic to the service

### Usage

1. **Build and push the image** (adjust registry and image name as needed):

```bash
cd deployment/kubernetes
docker build -t ghcr.io/your-username/jamaica-parish-explorer:latest ../..
docker push ghcr.io/your-username/jamaica-parish-explorer:latest
```

2. **Create secrets** for API keys and admin credentials:

```bash
kubectl create secret generic jamaica-secrets \
  --from-literal=RAPIDAPI_KEY=your_key \
  --from-literal=OPENSKY_CLIENT_ID=your_id \
  --from-literal=OPENSKY_CLIENT_SECRET=your_secret \
  --from-literal=AISSTREAM_API_KEY=your_key
```

3. **Deploy to your cluster**:

```bash
kubectl apply -f pvc.yaml
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
kubectl apply -f ingress.yaml
```

4. Point DNS for `jamaica.example.com` at your cluster's ingress controller address, and adjust hostnames/annotations as required for your environment.

### Persistent data

Run **PostgreSQL** as a managed service or a separate StatefulSet in the cluster; set **`DATABASE_URL`** on the app Deployment to point at it. A `PersistentVolumeClaim` (`pvc.yaml`) can still mount **`/data`** for **JSON caches** via **`JAMAICA_DATA_DIR=/data`**. Adjust `storageClassName` and `storage` size in `pvc.yaml` for your cluster.

> **Important:** Multiple API replicas are safe for reads/writes when they all use the same PostgreSQL server. Size the database tier for your expected concurrency.

See [`docs/DATA-MIGRATION-SQLITE-TO-POSTGRES.md`](../../docs/DATA-MIGRATION-SQLITE-TO-POSTGRES.md) if upgrading from SQLite-era deployments.
