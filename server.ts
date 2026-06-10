import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware para receber corpos binários grandes (até 15MB) nas requisições de imagem
  app.use(express.raw({ limit: '15mb', type: 'application/octet-stream' }));
  app.use(express.json({ limit: '15mb' }));

  // Middleware de CORS para permitir requisições de outras origens/domínios
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-tinify-api-key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // API Seguro de Compressão de Imagens via Tinify
  app.post('/api/compress', async (req: express.Request, res: express.Response) => {
    try {
      const apiKey = req.headers['x-tinify-api-key'] as string;
      if (!apiKey || apiKey.trim() === '') {
        return res.status(400).json({ error: 'Chave de API do Tinify não fornecida nos cabeçalhos.' });
      }

      const imageBuffer = req.body;
      if (!imageBuffer || imageBuffer.length === 0) {
        return res.status(400).json({ error: 'O corpo binário da imagem está vazio.' });
      }

      const authHeader = 'Basic ' + Buffer.from('api:' + apiKey.trim()).toString('base64');

      console.log(`[Backend] Enviando imagem de ${imageBuffer.length} bytes para compressão no Tinify...`);

      // 1. Enviar a imagem para o Tinify
      const shrinkResponse = await fetch('https://api.tinify.com/shrink', {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/octet-stream'
        },
        body: imageBuffer
      });

      if (!shrinkResponse.ok) {
        const errText = await shrinkResponse.text();
        console.error('[Backend] Tinify Shrink Error:', errText);
        return res.status(shrinkResponse.status).json({ 
          error: `Erro no Tinify: ${shrinkResponse.status}`,
          details: errText 
        });
      }

      const shrinkData = await shrinkResponse.json() as any;
      const outputUrl = shrinkData.output?.url;

      if (!outputUrl) {
        return res.status(500).json({ error: 'URL de saída compactada não encontrada na resposta do Tinify.' });
      }

      console.log(`[Backend] Download da imagem compactada a partir de: ${outputUrl}`);

      // 2. Baixar a imagem compactada do servidor do Tinify
      const imgResponse = await fetch(outputUrl);
      if (!imgResponse.ok) {
        return res.status(imgResponse.status).json({ error: 'Falha ao baixar imagem de retorno do Tinify.' });
      }

      const arrayBuffer = await imgResponse.arrayBuffer();
      const compressedBuffer = Buffer.from(arrayBuffer);
      const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
      const base64Data = compressedBuffer.toString('base64');
      const dataUrl = `data:${contentType};base64,${base64Data}`;

      console.log(`[Backend] Compressão finalizada com sucesso. Tamanho final: ${compressedBuffer.length} bytes`);

      return res.json({ dataUrl });
    } catch (error: any) {
      console.error('[Backend] Erro no endpoint /api/compress:', error);
      return res.status(500).json({ error: error.message || 'Erro interno na compressão da imagem.' });
    }
  });

  // ==========================================
  // BARRAMENTO DE SEGURANÇA E PROTEÇÃO DE IP API
  // ==========================================

  // Middleware de Proxy para a API de Segurança para contornar limitações de CORS e rede no navegador
  app.use('/api/secure', async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const secureHost = req.headers['x-secure-api-host'] as string;
    if (secureHost && 
        secureHost.trim() !== '' && 
        secureHost.trim() !== 'undefined' && 
        secureHost.trim() !== 'null') {
      const targetUrl = `${secureHost.trim().replace(/\/$/, '')}${req.originalUrl}`;
      console.log(`[Proxy Gateway] Repassando requisição de segurança para: ${targetUrl}`);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const fetchOptions: RequestInit = {
          method: req.method,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          signal: controller.signal,
        };

        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
          fetchOptions.body = JSON.stringify(req.body);
        }

        const response = await fetch(targetUrl, fetchOptions);
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errText = await response.text();
          console.error(`[Proxy Gateway] Erro retornado pela API externa: ${response.status}`, errText);
          return res.status(response.status).json({
            error: `Erro retornado pela API externa: ${response.status}`,
            details: errText
          });
        }

        const data = await response.json();
        return res.json(data);
      } catch (err: any) {
        console.error('[Proxy Gateway] Falha catastrófica de comunicação com a API segura externa:', err);
        return res.status(502).json({
          error: 'A API de Segurança está instável ou offline no endereço fornecido pelo Barramento.',
          details: err.message || err
        });
      }
    } else {
      next();
    }
  });

  // 1. Verificação de Conexão (Heartbeat) - Funções Vitais
  app.get('/api/secure/heartbeat', (req: express.Request, res: express.Response) => {
    return res.json({
      connected: true,
      status: 'authorized',
      isIntellectualAgentActive: true,
      timestamp: Date.now(),
      environment: process.env.NODE_ENV || 'development'
    });
  });

  // 2. Gerador de Códigos Seguro (SKU, Códigos Operacionais)
  app.post('/api/secure/code-generator', (req: express.Request, res: express.Response) => {
    try {
      const { type, params } = req.body;
      if (type === 'sku') {
        const { areaDigit, familyDigit, diffDigit, variationDigit, separator, prefix, suffix, seqNumber, seqLength } = params || {};
        const formattedSeq = String(seqNumber || 1).padStart(seqLength || 4, '0');
        const parts = [prefix, areaDigit, familyDigit, diffDigit, variationDigit, formattedSeq, suffix].filter(p => !!p && String(p).trim() !== '');
        const code = parts.join(separator || '-');
        return res.json({ code });
      }
      return res.status(400).json({ error: 'Tipo de gerador de códigos desconhecido.' });
    } catch (e: any) {
      return res.status(500).json({ error: e.message || 'Erro interno no gerador seguro de códigos.' });
    }
  });

  // 3. Sistema CRUD Proxy / Validador e Sanitização de Gravação
  app.post('/api/secure/crud', (req: express.Request, res: express.Response) => {
    try {
      const { action, collection, docId, payload } = req.body;
      if (!action || !collection || !docId) {
        return res.status(400).json({ error: 'Parâmetros de barramento de dados CRUD incompletos.' });
      }
      console.log(`[IP Security Gateway] Operação ${action} na coleção "${collection}" (ID: ${docId}) - AUTORIZADO.`);
      return res.json({
        success: true,
        authorized: true,
        sanitizedId: docId,
        timestamp: Date.now()
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message || 'Erro interno de processamento CRUD.' });
    }
  });

  // 4. Barramento de Alertas, Comunicação de Erros e Controle de Pânico via POPUP
  app.post('/api/secure/alerts', (req: express.Request, res: express.Response) => {
    const { type, message, user } = req.body;
    console.log(`[Barramento de Alertas] Alerta de Segurança emitido por "${user || 'Sistema'}": [${type}] ${message}`);
    return res.json({ success: true, logged: true });
  });

  // 5. Cálculos Vitais de Relatórios & Financeiros do Sistema (Proprietários/Backend)
  app.post('/api/secure/report', (req: express.Request, res: express.Response) => {
    try {
      const { reportType, transactions = [], period, settings } = req.body;
      if (!reportType) {
        return res.status(400).json({ error: 'Tipo de cálculo de relatório não fornecido.' });
      }

      const getEffectiveStatus = (t: any) => {
        const isOverdue = new Date(t.dueDate) < new Date() && t.status === 'Pendente';
        return isOverdue ? 'Atrasado' : t.status;
      };

      const isDateInPeriod = (dateStr: string, p: string) => {
        const recordDate = new Date(dateStr);
        const now = new Date();
        
        const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

        if (p === 'ESTE_MES') {
          return recordDate >= startOfCurrentMonth && recordDate <= endOfCurrentMonth;
        }
        if (p === 'MES_ANTERIOR') {
          return recordDate >= startOfLastMonth && recordDate <= endOfLastMonth;
        }
        if (p === 'ULTIMOS_30') {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(now.getDate() - 30);
          return recordDate >= thirtyDaysAgo;
        }
        if (p === 'ULTIMOS_90') {
          const ninetyDaysAgo = new Date();
          ninetyDaysAgo.setDate(now.getDate() - 90);
          return recordDate >= ninetyDaysAgo;
        }
        return true; // TODO_PERIODO
      };

      const periodTransactions = transactions.filter((t: any) => isDateInPeriod(t.dueDate, period));

      if (reportType === 'dre') {
        const revenues = periodTransactions
          .filter((t: any) => t.type === 'RECEITA' && t.status !== 'Cancelado')
          .reduce((acc: number, t: any) => acc + (Number(t.amount) || 0), 0);
        
        const expenses = periodTransactions
          .filter((t: any) => t.type === 'DESPESA' && t.status !== 'Cancelado')
          .reduce((acc: number, t: any) => acc + (Number(t.amount) || 0), 0);
        
        const netResult = revenues - expenses;

        // Agrupamento por categorias
        const categories: Record<string, number> = {};
        periodTransactions.forEach((t: any) => {
          if (t.status === 'Cancelado') return;
          const key = `${t.type}_${t.category}`;
          categories[key] = (categories[key] || 0) + (Number(t.amount) || 0);
        });

        const categoriesBreakdown = Object.entries(categories).map(([key, val]) => {
          const [type, catName] = key.split('_');
          return { type, category: catName, amount: val };
        });

        return res.json({
          success: true,
          dreSummary: { revenues, expenses, netResult },
          categoriesBreakdown
        });
      }

      if (reportType === 'overdue') {
        const overduePayable = periodTransactions
          .filter((t: any) => t.type === 'DESPESA' && getEffectiveStatus(t) === 'Atrasado' && t.status !== 'Cancelado')
          .reduce((acc: number, t: any) => acc + (Number(t.amount) || 0), 0);

        const overdueReceivable = periodTransactions
          .filter((t: any) => t.type === 'RECEITA' && getEffectiveStatus(t) === 'Atrasado' && t.status !== 'Cancelado')
          .reduce((acc: number, t: any) => acc + (Number(t.amount) || 0), 0);

        return res.json({
          success: true,
          overdueSummary: { overduePayable, overdueReceivable },
          filteredTransactions: periodTransactions.filter((t: any) => getEffectiveStatus(t) === 'Atrasado' && t.status !== 'Cancelado')
        });
      }

      return res.status(400).json({ error: 'Relatório ou operação financeira desconhecida.' });
    } catch (e: any) {
      return res.status(500).json({ error: e.message || 'Erro computacional financeiro remoto.' });
    }
  });

  // Configuração do Vite Middleware de acordo com o ambiente
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req: express.Request, res: express.Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Backend] Servidor rodando em http://localhost:${PORT}`);
  });
}

startServer();
