// 基于 Cloudflare request.cf 提取请求来源的地理定位（IP 推断，城市级精度）。
// cf 由边缘节点自动注入；字段可能缺失或为空（本地测试、部分 IP、非 200 情况），
// 这里全部做空值兜底，调用方据此决定是否落库。
const cleanString = (value) => {
    const text = String(value ?? '').trim();
    return text || null;
};

export function extractGeoFromRequest(req) {
    const cf = req?.raw?.cf;
    const latitude = Number(cf?.latitude);
    const longitude = Number(cf?.longitude);
    return {
        ip: String(req?.ip || '').trim() || null,
        latitude: Number.isFinite(latitude) && Math.abs(latitude) <= 90 ? latitude : null,
        longitude: Number.isFinite(longitude) && Math.abs(longitude) <= 180 ? longitude : null,
        city: cleanString(cf?.city),
        countryCode: cleanString(cf?.country),
        region: cleanString(cf?.region),
        timezone: cleanString(cf?.timezone),
        organization: cleanString(cf?.asOrganization)
    };
}
