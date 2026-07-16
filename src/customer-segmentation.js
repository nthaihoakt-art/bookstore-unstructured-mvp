// ── K-Means Customer Segmentation ──
// Features: [total_spent, order_count]
// Clusters: VIP, Thân thiết, Vãng lai, Học sinh/Sinh viên

function euclidean(a, b) {
  return Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));
}

function normalize(data) {
  const n = data[0].length;
  const mins = Array(n).fill(Infinity);
  const maxs = Array(n).fill(-Infinity);
  data.forEach(row => row.forEach((v, j) => {
    if (v < mins[j]) mins[j] = v;
    if (v > maxs[j]) maxs[j] = v;
  }));
  return data.map(row => row.map((v, j) => {
    if (maxs[j] === mins[j]) return 0.5;
    return (v - mins[j]) / (maxs[j] - mins[j]);
  }));
}

function kmeans(data, k = 4, maxIter = 100) {
  if (data.length === 0) return { clusters: [], centroids: [], labels: [] };

  const normalized = normalize(data);
  const dim = normalized[0].length;

  // Initialize centroids via k-means++
  const centroids = [];
  centroids.push([...normalized[Math.floor(Math.random() * normalized.length)]]);
  for (let i = 1; i < k; i++) {
    const dists = normalized.map(p => Math.min(...centroids.map(c => euclidean(p, c))));
    const sumDist = dists.reduce((a, b) => a + b, 0);
    let r = Math.random() * sumDist;
    let idx = 0;
    for (; idx < dists.length && r > dists[idx]; idx++) r -= dists[idx];
    centroids.push([...normalized[Math.min(idx, normalized.length - 1)]]);
  }

  let labels = new Array(normalized.length).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    // Assign
    for (let i = 0; i < normalized.length; i++) {
      let minDist = Infinity, best = 0;
      for (let j = 0; j < k; j++) {
        const d = euclidean(normalized[i], centroids[j]);
        if (d < minDist) { minDist = d; best = j; }
      }
      if (labels[i] !== best) { labels[i] = best; changed = true; }
    }
    if (!changed) break;
    // Update
    const sums = Array.from({ length: k }, () => Array(dim).fill(0));
    const counts = Array(k).fill(0);
    for (let i = 0; i < normalized.length; i++) {
      const c = labels[i];
      counts[c]++;
      for (let j = 0; j < dim; j++) sums[c][j] += normalized[i][j];
    }
    for (let j = 0; j < k; j++) {
      if (counts[j] > 0) for (let d = 0; d < dim; d++) centroids[j][d] = sums[j][d] / counts[j];
    }
  }

  return { centroids, labels, normalized };
}

function labelClusters(centroids, labels, rawData) {
  // Compute cluster stats from raw data
  const k = centroids.length;
  const clusterStats = [];
  for (let j = 0; j < k; j++) {
    const members = rawData.filter((_, i) => labels[i] === j);
    if (members.length === 0) { clusterStats.push({ totalSpent: 0, orderCount: 0, count: 0 }); continue; }
    const avgSpent = members.reduce((s, r) => s + r[0], 0) / members.length;
    const avgOrders = members.reduce((s, r) => s + r[1], 0) / members.length;
    clusterStats.push({ totalSpent: avgSpent, orderCount: avgOrders, count: members.length });
  }

  // Score each cluster: weight = avgSpent * 0.7 + avgOrders * 0.3
  const scores = clusterStats.map(s => ({
    ...s,
    score: (s.totalSpent || 0) * 0.7 + (s.orderCount || 0) * 0.3
  }));

  // Sort by score descending
  const ranked = scores.map((s, i) => ({ ...s, clusterId: i }))
    .sort((a, b) => b.score - a.score);

  const segmentNames = ['VIP', 'Khách thân thiết', 'Khách vãng lai', 'Học sinh / Sinh viên'];
  const clusterToLabel = {};
  ranked.forEach((s, rank) => {
    clusterToLabel[s.clusterId] = segmentNames[Math.min(rank, segmentNames.length - 1)];
  });

  return { clusterStats: scores, clusterToLabel };
}

function segmentCustomers(db) {
  // Aggregate: per customer, total spent & order count
  const rows = db.prepare(`
    SELECT c.id, c.full_name, c.type,
      COALESCE(SUM(o.total), 0) total_spent,
      COUNT(o.id) order_count
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    GROUP BY c.id
    ORDER BY c.id
  `).all();

  if (rows.length < 4) {
    return rows.map(r => ({ ...r, segment: 'Chưa đủ dữ liệu' }));
  }

  const rawData = rows.map(r => [r.total_spent, r.order_count]);
  const { labels, clusterStats, clusterToLabel } = (() => {
    const result = kmeans(rawData, 4);
    const stats = labelClusters(result.centroids, result.labels, rawData);
    // Map cluster IDs to segment names
    const mapping = stats.clusterToLabel;
    return { labels: result.labels, clusterStats: stats.clusterStats, clusterToLabel: mapping };
  })();

  return rows.map((r, i) => ({
    ...r,
    segment: clusterToLabel[labels[i]] || 'Không xác định',
    cluster_id: labels[i]
  }));
}

async function segmentCustomersMongo(CustomerModel) {
  const rows = await CustomerModel.aggregate([
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'customerId',
        as: 'orders'
      }
    },
    {
      $project: {
        id: '$_id',
        full_name: '$fullName',
        type: '$type',
        total_spent: { $sum: '$orders.total' },
        order_count: { $size: '$orders' }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  if (rows.length < 4) {
    return rows.map(r => ({
      id: r.id,
      full_name: r.full_name,
      type: r.type,
      total_spent: r.total_spent,
      order_count: r.order_count,
      segment: 'Chưa đủ dữ liệu'
    }));
  }

  const rawData = rows.map(r => [r.total_spent, r.order_count]);
  const result = kmeans(rawData, 4);
  const stats = labelClusters(result.centroids, result.labels, rawData);
  const clusterToLabel = stats.clusterToLabel;

  return rows.map((r, i) => ({
    id: r.id,
    full_name: r.full_name,
    type: r.type,
    total_spent: r.total_spent,
    order_count: r.order_count,
    segment: clusterToLabel[result.labels[i]] || 'Không xác định',
    cluster_id: result.labels[i]
  }));
}

module.exports = { segmentCustomers, segmentCustomersMongo, kmeans };
