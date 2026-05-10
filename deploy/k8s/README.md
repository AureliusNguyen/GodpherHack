# Kubernetes manifests for GodpherHack Hub

These manifests deploy the Hub at production scale: 2 replicas with HPA
to 10, ingress with WebSocket upgrade for `/ws/collab`, ServiceMonitor
for prometheus-operator scraping.

## Layout

```
namespace.yaml         Namespace
configmap.yaml         Non-secret config (HUB_BASE_URL, index name)
secret.yaml.template   Secret template -- do NOT apply directly
deployment.yaml        Hub Deployment (2 replicas, security-hardened)
service.yaml           ClusterIP on port 80 -> hub:3000
ingress.yaml           nginx Ingress with TLS + WebSocket support
hpa.yaml               HorizontalPodAutoscaler 2-10 on CPU/memory
servicemonitor.yaml    prometheus-operator scrape config (optional)
kustomization.yaml     Bundles everything except secret.yaml.template
```

## Apply

```bash
# 1. Build and push the image somewhere your cluster can pull
docker build -t YOUR_REGISTRY/godpherhack-hub:VERSION .
docker push YOUR_REGISTRY/godpherhack-hub:VERSION

# 2. Edit deployment.yaml -> spec.template.spec.containers[0].image to your tag
# 3. Edit configmap.yaml + ingress.yaml host to match your domain
# 4. Create the secret (do this BEFORE applying)
kubectl create namespace godpherhack
kubectl create secret generic godpherhack-hub-secrets \
  -n godpherhack \
  --from-literal=PINECONE_API_KEY=... \
  --from-literal=JWT_SECRET=$(openssl rand -hex 32) \
  --from-literal=GITHUB_CLIENT_ID=... \
  --from-literal=GITHUB_CLIENT_SECRET=... \
  --from-literal=ANTHROPIC_API_KEY=...

# 5. Apply the rest
kubectl apply -k deploy/k8s/
```

## Validate without a cluster

```bash
kubectl apply --dry-run=client -k deploy/k8s/
```

## What's deferred

- Service mesh / mTLS between Hub instances
- Network policies (lock down egress to GitHub + Pinecone + Anthropic only)
- PodDisruptionBudget (the rolling-update strategy already gives
  zero-downtime deploys, but a PDB is still good hygiene)
- Multi-instance presence/feed sync via Redis Pub/Sub. Today
  CollabHub is in-memory per pod, so users only see peers on the same
  pod. Sticky sessions (via ingress session affinity) is a
  workaround; Redis is the real fix.
