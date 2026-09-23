/**
 * 全量导入测试数据
 * 覆盖所有分隔符、字段组合、特殊格式
 *
 * 注意：
 * - Secret 必须是合法 base32（仅 A-Z 和 2-7），长度 >= 16
 * - 解析器会按位置优先识别密码，不再要求密码避开 base32 形态
 * - | 分隔符不能有连续 || 空字段
 */

// ---- 分隔符：完整字段
export const FULL_FIELDS_DASH4 = [
  'alice@gmail.com----p0ss1899----recovery_alice@gmail.com----JBSWY3DPEHPK3PXP <备注A>',
  'bob@gmail.com----b0bp@ss----recovery_bob@gmail.com----MFZWQ5DJNZTSA3TP----2021----India',
].join('\n');

// —— 分隔符：含手机号
export const FULL_FIELDS_CN_DASH = [
  'charlie@gmail.com——ch@r1ie99——rec_charlie@gmail.com——13812345678——GEZDGNBVGY3TQOJQ',
  'david@gmail.com——d@v1d890——rec_david@gmail.com——+8615900001111——KBAFEWSYJBCFQ3DP',
].join('\n');

// | 分隔符：标准格式（不能有 || 空字段）
export const PIPE_SEPARATED = [
  'echo@gmail.com|ech0p@ss|rec_echo@gmail.com|JBSWY3DPEHPK3PXP',
  'frank@gmail.com|fr@nk890|rec_frank@gmail.com|NFXHA5DFMRWGK3TD',
  'grace@gmail.com|gr@ce901|rec_grace@gmail.com',
  'henry@gmail.com|h8nryp0ss|MFZWQ5DJNZTSA3TP',
].join('\n');

// --- 分隔符
export const DASH3_SEPARATED = [
  'ivan@gmail.com---1v@np0ss---rec_ivan@gmail.com---GEZDGNBVGY3TQOJQ',
  'julia@gmail.com---ju1i@890---rec_julia@gmail.com',
].join('\n');

// -- 分隔符
export const DASH2_SEPARATED = [
  'kate@gmail.com--k@te1890--rec_kate@gmail.com--KBAFEWSYJBCFQ3DP',
  'leo@gmail.com--le0p@ss',
].join('\n');

// 特殊格式：卡号：xxx密码：xxx
export const SPECIAL_FORMAT = [
  '卡号：special1@gmail.com密码：sp8c1@l01----JBSWY3DPEHPK3PXP',
  '卡号：special2@gmail.com密码：sp8c1@l02|NFXHA5DFMRWGK3TD',
].join('\n');

// 含注释、空行、URL 等应跳过的行
export const WITH_NOISE = [
  '# 这是一组测试账号',
  '// 下面是有效数据',
  '',
  'noise1@gmail.com----n01sep@ss----rec_noise@gmail.com',
  'https://example.com/should-be-skipped',
  '第1组',
  'noise2@gmail.com----n01se890',
  '--------',
  '待加入',
  'noise3@gmail.com|n01se901|rec_noise3@gmail.com|MFZWQ5DJNZTSA3TP',
].join('\n');

// 含分组前缀和标注
export const WITH_GROUPS_AND_TAGS = [
  '主号：group1@gmail.com----gr0up890----rec_group1@gmail.com <VIP>',
  '成员1：member1@gmail.com----m8mb8r01 <重要>',
  '成员2：member2@gmail.com----m8mb8r02----rec_member2@gmail.com----GEZDGNBVGY3TQOJQ <测试>',
].join('\n');

// 含年份和国家
export const WITH_YEAR_COUNTRY = [
  'year1@gmail.com----y8@rp0ss----2020----China',
  'year2@gmail.com----y8@rp1ss----rec_year2@gmail.com----2023----Japan',
  'year3@gmail.com|y8@rp9ss|rec_year3@gmail.com|KBAFEWSYJBCFQ3DP|2019|India',
].join('\n');

// 含 2fa.live URL（URL 中的 path 必须是合法 base32）
export const WITH_2FA_URL = [
  'twofa1@gmail.com----tw0f@p0ss----https://2fa.live/tok/jbswy3dpehpk3pxp',
  'twofa2@gmail.com|tw0f@p1ss|rec_twofa2@gmail.com|https://2fa.live/ok/nfxha5dfmrwgk3td',
].join('\n');

// 仅邮箱+密码（最小字段，密码含 0/1/8/9 避免被识别为 secret）
export const MINIMAL_FIELDS = [
  'min1@gmail.com----m1np@ss01',
  'min2@gmail.com|m1np@ss02',
  'min3@gmail.com——m1np@ss03',
  'min4@gmail.com---m1np@ss04',
  'min5@gmail.com--m1np@ss05',
].join('\n');

/**
 * 全量测试数据：合并所有格式
 */
export const FULL_TEST_DATA = [
  '# === 全量导入测试数据 ===',
  '',
  '# ---- 分隔符',
  FULL_FIELDS_DASH4,
  '',
  '# —— 分隔符',
  FULL_FIELDS_CN_DASH,
  '',
  '# | 分隔符',
  PIPE_SEPARATED,
  '',
  '# --- 分隔符',
  DASH3_SEPARATED,
  '',
  '# -- 分隔符',
  DASH2_SEPARATED,
  '',
  '# 特殊格式',
  SPECIAL_FORMAT,
  '',
  '# 含噪声行',
  WITH_NOISE,
  '',
  '# 含分组和标注',
  WITH_GROUPS_AND_TAGS,
  '',
  '# 含年份和国家',
  WITH_YEAR_COUNTRY,
  '',
  '# 含 2fa.live URL',
  WITH_2FA_URL,
  '',
  '# 最小字段',
  MINIMAL_FIELDS,
].join('\n');

/**
 * 全量数据解析后的预期结果
 * 每条记录对应 FULL_TEST_DATA 中的一行有效数据
 */
export const EXPECTED_ACCOUNTS = [
  // FULL_FIELDS_DASH4
  { email: 'alice@gmail.com', password: 'p0ss1899', recovery: 'recovery_alice@gmail.com', phone: '', secret: 'JBSWY3DPEHPK3PXP', reg_year: '', country: '', group_name: '', remark: '备注A' },
  { email: 'bob@gmail.com', password: 'b0bp@ss', recovery: 'recovery_bob@gmail.com', phone: '', secret: 'MFZWQ5DJNZTSA3TP', reg_year: '2021', country: 'India', group_name: '', remark: '' },
  // FULL_FIELDS_CN_DASH
  { email: 'charlie@gmail.com', password: 'ch@r1ie99', recovery: 'rec_charlie@gmail.com', phone: '+8613812345678', secret: 'GEZDGNBVGY3TQOJQ', reg_year: '', country: '', group_name: '', remark: '' },
  { email: 'david@gmail.com', password: 'd@v1d890', recovery: 'rec_david@gmail.com', phone: '+8615900001111', secret: 'KBAFEWSYJBCFQ3DP', reg_year: '', country: '', group_name: '', remark: '' },
  // PIPE_SEPARATED
  { email: 'echo@gmail.com', password: 'ech0p@ss', recovery: 'rec_echo@gmail.com', phone: '', secret: 'JBSWY3DPEHPK3PXP', reg_year: '', country: '', group_name: '', remark: '' },
  { email: 'frank@gmail.com', password: 'fr@nk890', recovery: 'rec_frank@gmail.com', phone: '', secret: 'NFXHA5DFMRWGK3TD', reg_year: '', country: '', group_name: '', remark: '' },
  { email: 'grace@gmail.com', password: 'gr@ce901', recovery: 'rec_grace@gmail.com', phone: '', secret: '', reg_year: '', country: '', group_name: '', remark: '' },
  { email: 'henry@gmail.com', password: 'h8nryp0ss', recovery: '', phone: '', secret: 'MFZWQ5DJNZTSA3TP', reg_year: '', country: '', group_name: '', remark: '' },
  // DASH3_SEPARATED
  { email: 'ivan@gmail.com', password: '1v@np0ss', recovery: 'rec_ivan@gmail.com', phone: '', secret: 'GEZDGNBVGY3TQOJQ', reg_year: '', country: '', group_name: '', remark: '' },
  { email: 'julia@gmail.com', password: 'ju1i@890', recovery: 'rec_julia@gmail.com', phone: '', secret: '', reg_year: '', country: '', group_name: '', remark: '' },
  // DASH2_SEPARATED
  { email: 'kate@gmail.com', password: 'k@te1890', recovery: 'rec_kate@gmail.com', phone: '', secret: 'KBAFEWSYJBCFQ3DP', reg_year: '', country: '', group_name: '', remark: '' },
  { email: 'leo@gmail.com', password: 'le0p@ss', recovery: '', phone: '', secret: '', reg_year: '', country: '', group_name: '', remark: '' },
  // SPECIAL_FORMAT
  { email: 'special1@gmail.com', password: 'sp8c1@l01', recovery: '', phone: '', secret: 'JBSWY3DPEHPK3PXP', reg_year: '', country: '', group_name: '', remark: '' },
  { email: 'special2@gmail.com', password: 'sp8c1@l02', recovery: '', phone: '', secret: 'NFXHA5DFMRWGK3TD', reg_year: '', country: '', group_name: '', remark: '' },
  // WITH_NOISE (3 valid lines)
  { email: 'noise1@gmail.com', password: 'n01sep@ss', recovery: 'rec_noise@gmail.com', phone: '', secret: '', reg_year: '', country: '', group_name: '', remark: '' },
  { email: 'noise2@gmail.com', password: 'n01se890', recovery: '', phone: '', secret: '', reg_year: '', country: '', group_name: '', remark: '' },
  { email: 'noise3@gmail.com', password: 'n01se901', recovery: 'rec_noise3@gmail.com', phone: '', secret: 'MFZWQ5DJNZTSA3TP', reg_year: '', country: '', group_name: '', remark: '' },
  // WITH_GROUPS_AND_TAGS
  { email: 'group1@gmail.com', password: 'gr0up890', recovery: 'rec_group1@gmail.com', phone: '', secret: '', reg_year: '', country: '', group_name: '主号', remark: 'VIP' },
  { email: 'member1@gmail.com', password: 'm8mb8r01', recovery: '', phone: '', secret: '', reg_year: '', country: '', group_name: '成员1', remark: '重要' },
  { email: 'member2@gmail.com', password: 'm8mb8r02', recovery: 'rec_member2@gmail.com', phone: '', secret: 'GEZDGNBVGY3TQOJQ', reg_year: '', country: '', group_name: '成员2', remark: '测试' },
  // WITH_YEAR_COUNTRY
  { email: 'year1@gmail.com', password: 'y8@rp0ss', recovery: '', phone: '', secret: '', reg_year: '2020', country: 'China', group_name: '', remark: '' },
  { email: 'year2@gmail.com', password: 'y8@rp1ss', recovery: 'rec_year2@gmail.com', phone: '', secret: '', reg_year: '2023', country: 'Japan', group_name: '', remark: '' },
  { email: 'year3@gmail.com', password: 'y8@rp9ss', recovery: 'rec_year3@gmail.com', phone: '', secret: 'KBAFEWSYJBCFQ3DP', reg_year: '2019', country: 'India', group_name: '', remark: '' },
  // WITH_2FA_URL
  { email: 'twofa1@gmail.com', password: 'tw0f@p0ss', recovery: '', phone: '', secret: 'JBSWY3DPEHPK3PXP', reg_year: '', country: '', group_name: '', remark: '' },
  { email: 'twofa2@gmail.com', password: 'tw0f@p1ss', recovery: 'rec_twofa2@gmail.com', phone: '', secret: 'NFXHA5DFMRWGK3TD', reg_year: '', country: '', group_name: '', remark: '' },
  // MINIMAL_FIELDS
  { email: 'min1@gmail.com', password: 'm1np@ss01', recovery: '', phone: '', secret: '', reg_year: '', country: '', group_name: '', remark: '' },
  { email: 'min2@gmail.com', password: 'm1np@ss02', recovery: '', phone: '', secret: '', reg_year: '', country: '', group_name: '', remark: '' },
  { email: 'min3@gmail.com', password: 'm1np@ss03', recovery: '', phone: '', secret: '', reg_year: '', country: '', group_name: '', remark: '' },
  { email: 'min4@gmail.com', password: 'm1np@ss04', recovery: '', phone: '', secret: '', reg_year: '', country: '', group_name: '', remark: '' },
  { email: 'min5@gmail.com', password: 'm1np@ss05', recovery: '', phone: '', secret: '', reg_year: '', country: '', group_name: '', remark: '' },
];

export const EXPECTED_TOTAL_COUNT = EXPECTED_ACCOUNTS.length;
