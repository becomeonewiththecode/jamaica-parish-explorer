## Option 6: Kubernetes deployment

This option runs the app on a Kubernetes cluster using a Deployment, Service, and Ingress.

### Files

- `Dockerfile` — builds a production image suitable for Kubernetes
- `deployment.yaml` — `Deployment` with 2 replicas and health probes
- `service.yaml` — `ClusterIP` service exposing the app on port 80 inside the cluster
- `ingress.yaml` — example `Ingress` routing HTTP traffic to the service

### Usage

1. **Build and push the image** (adjust registry and image name as needed):

```bash
cd deployment/option6-kubernetes
docker build -t ghcr.io/your-username/jamaica-parish-explorer:latest ../..
docker push ghcr.io/your-username/jamaica-parish-explorer:latest
```

2. **Deploy to your cluster**:

```bash
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
kubectl apply -f ingress.yaml
```

3. Point DNS for `jamaica.example.com` at your cluster's ingress controller address, and adjust hostnames/annotations as required for your environment.

