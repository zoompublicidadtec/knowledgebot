"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var supabase_js_1 = require("@supabase/supabase-js");
var fs = __importStar(require("fs"));
var path = __importStar(require("path"));
var papaparse_1 = __importDefault(require("papaparse"));
var transformers_1 = require("@xenova/transformers");
var envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    var envConfig = fs.readFileSync(envPath, 'utf8');
    for (var _i = 0, _a = envConfig.split('\n'); _i < _a.length; _i++) {
        var line = _a[_i];
        var match = line.match(/^([^#=]+)=(.*)$/);
        if (match) {
            process.env[match[1].trim()] = match[2].trim();
        }
    }
}
var supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
var supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
    console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
    process.exit(1);
}
var supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
// Chunk text
function chunkText(text, chunkSize, overlap) {
    if (chunkSize === void 0) { chunkSize = 800; }
    if (overlap === void 0) { overlap = 100; }
    var chunks = [];
    var i = 0;
    while (i < text.length) {
        var end = Math.min(i + chunkSize, text.length);
        if (end < text.length) {
            var nextNewline = text.lastIndexOf('\n', end);
            var nextPeriod = text.lastIndexOf('.', end);
            var splitIndex = Math.max(nextNewline, nextPeriod);
            if (splitIndex > i + chunkSize / 2) {
                end = splitIndex + 1;
            }
        }
        chunks.push(text.slice(i, end).trim());
        i = end - overlap;
    }
    return chunks.filter(function (c) { return c.length > 0; });
}
function ingestFile(filePath) {
    return __awaiter(this, void 0, void 0, function () {
        var title, orgData, orgId, newOrg, extractor, content, textToProcess, parsed, _a, doc, docError, documentId, chunks, batchSize, _loop_1, i;
        var _this = this;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    title = path.basename(filePath);
                    return [4 /*yield*/, supabase.from('organizations').select('id').limit(1)];
                case 1:
                    orgData = (_b.sent()).data;
                    orgId = '';
                    if (!(!orgData || orgData.length === 0)) return [3 /*break*/, 3];
                    return [4 /*yield*/, supabase.from('organizations').insert({
                            name: 'KnowledgeBot Default Org',
                            slug: 'knowledgebot-default'
                        }).select('id').single()];
                case 2:
                    newOrg = (_b.sent()).data;
                    if (newOrg)
                        orgId = newOrg.id;
                    return [3 /*break*/, 4];
                case 3:
                    orgId = orgData[0].id;
                    _b.label = 4;
                case 4:
                    if (!orgId)
                        throw new Error('No se pudo encontrar o crear una organización');
                    console.log('Cargando el motor de inteligencia artificial local (esto puede tardar unos segundos la primera vez)...');
                    return [4 /*yield*/, (0, transformers_1.pipeline)('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2')];
                case 5:
                    extractor = _b.sent();
                    content = fs.readFileSync(filePath, 'utf-8');
                    textToProcess = '';
                    if (filePath.toLowerCase().endsWith('.csv')) {
                        parsed = papaparse_1.default.parse(content, { header: true, skipEmptyLines: true });
                        textToProcess = parsed.data.map(function (row) { return JSON.stringify(row); }).join('\n');
                    }
                    else {
                        textToProcess = content;
                    }
                    console.log("Procesando ".concat(title, "..."));
                    return [4 /*yield*/, supabase
                            .from('knowledge_documents')
                            .insert({
                            organization_id: orgId,
                            title: title,
                            source_type: 'manual',
                            source_url: filePath,
                        })
                            .select('id')
                            .single()];
                case 6:
                    _a = _b.sent(), doc = _a.data, docError = _a.error;
                    if (docError || !doc) {
                        throw new Error("Error insertando documento: ".concat(docError === null || docError === void 0 ? void 0 : docError.message));
                    }
                    documentId = doc.id;
                    chunks = chunkText(textToProcess);
                    console.log("Se crearon ".concat(chunks.length, " fragmentos de memoria. Generando vectores localmente..."));
                    batchSize = 10;
                    _loop_1 = function (i) {
                        var chunkBatch, embeddings_1, rows, insertError, e_1;
                        return __generator(this, function (_c) {
                            switch (_c.label) {
                                case 0:
                                    chunkBatch = chunks.slice(i, i + batchSize);
                                    console.log("Inyectando fragmentos ".concat(i + 1, " a ").concat(Math.min(i + batchSize, chunks.length), " de ").concat(chunks.length, "..."));
                                    _c.label = 1;
                                case 1:
                                    _c.trys.push([1, 4, , 5]);
                                    return [4 /*yield*/, Promise.all(chunkBatch.map(function (text) { return __awaiter(_this, void 0, void 0, function () {
                                            var output;
                                            return __generator(this, function (_a) {
                                                switch (_a.label) {
                                                    case 0: return [4 /*yield*/, extractor(text, { pooling: 'mean', normalize: true })];
                                                    case 1:
                                                        output = _a.sent();
                                                        return [2 /*return*/, Array.from(output.data)];
                                                }
                                            });
                                        }); }))];
                                case 2:
                                    embeddings_1 = _c.sent();
                                    rows = chunkBatch.map(function (chunkText, idx) { return ({
                                        organization_id: orgId,
                                        document_id: documentId,
                                        content: chunkText,
                                        embedding: embeddings_1[idx],
                                        token_count: Math.ceil(chunkText.length / 4)
                                    }); });
                                    return [4 /*yield*/, supabase
                                            .from('knowledge_chunks')
                                            .insert(rows)];
                                case 3:
                                    insertError = (_c.sent()).error;
                                    if (insertError) {
                                        console.error("Error guardando en BD: ".concat(insertError.message));
                                    }
                                    return [3 /*break*/, 5];
                                case 4:
                                    e_1 = _c.sent();
                                    console.error("Error local: ".concat(e_1.message));
                                    return [3 /*break*/, 5];
                                case 5: return [2 /*return*/];
                            }
                        });
                    };
                    i = 0;
                    _b.label = 7;
                case 7:
                    if (!(i < chunks.length)) return [3 /*break*/, 10];
                    return [5 /*yield**/, _loop_1(i)];
                case 8:
                    _b.sent();
                    _b.label = 9;
                case 9:
                    i += batchSize;
                    return [3 /*break*/, 7];
                case 10:
                    console.log("\u00A1Memoria inyectada con \u00E9xito!");
                    return [2 /*return*/];
            }
        });
    });
}
var targetPath = process.argv[2];
if (!targetPath) {
    console.log('Debes proporcionar la ruta de un archivo.');
    process.exit(1);
}
ingestFile(targetPath).catch(console.error);
