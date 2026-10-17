import React, { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import { format, subDays, isAfter, differenceInMinutes } from 'date-fns'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea } from 'recharts'
import { Droplet, Thermometer, AlertTriangle, CheckCircle, WifiOff, ZapOff, Clock, Send, TrendingUp, TrendingDown, Activity } from 'lucide-react'

function App() {
  const [data, setData] = useState([])
  const [currentStatus, setCurrentStatus] = useState(null)
  const [timeRange, setTimeRange] = useState('day')
  const [now, setNow] = useState(new Date())

  // Update current time every 30 seconds for accurate offline detection
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])

  // Fetch the latest current status directly from the database
  async function fetchCurrentStatus() {
    const { data: latestRow, error } = await supabase
      .from('hydro_data')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!error && latestRow) {
      setCurrentStatus(latestRow)
    }
  }

  // Fetch chart data according to time range with pagination support
  async function fetchChartData(range) {
    const nowTime = new Date()
    let startDate = null
    if (range === 'day') startDate = subDays(nowTime, 1)
    else if (range === 'week') startDate = subDays(nowTime, 7)
    else if (range === 'month') startDate = subDays(nowTime, 30)

    let allData = []
    let from = 0
    const pageSize = 1000

    try {
      while (allData.length < 5000) {
        let query = supabase
          .from('hydro_data')
          .select('*')
          .order('created_at', { ascending: true })
          .range(from, from + pageSize - 1)

        if (startDate) {
          query = query.gte('created_at', startDate.toISOString())
        }

        const { data: batch, error } = await query
        if (error || !batch || batch.length === 0) break
        allData.push(...batch)
        if (batch.length < pageSize) break
        from += pageSize
      }

      setData(allData)
    } catch (err) {
      console.error('Error fetching chart data:', err)
    }
  }

  // Initial fetch and Supabase Realtime subscription + periodic refresh
  useEffect(() => {
    fetchCurrentStatus()
    fetchChartData(timeRange)
    
    // Subscribe to new real-time readings
    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hydro_data' }, payload => {
        setData(prev => [...prev, payload.new])
        setCurrentStatus(payload.new)
      })
      .subscribe()

    // Periodically refresh current status every 30s
    const statusInterval = setInterval(() => {
      fetchCurrentStatus()
    }, 30000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(statusInterval)
    }
  }, [])

  // Refetch chart data whenever user changes time range
  useEffect(() => {
    fetchChartData(timeRange)
  }, [timeRange])

  // Offline / Power Outage calculation
  const diffSinceLastUpdate = currentStatus?.created_at 
    ? differenceInMinutes(now, new Date(currentStatus.created_at)) 
    : 0;
  const isOffline = currentStatus?.created_at ? diffSinceLastUpdate >= 5 : false;

  // Process data for chart & filter
  const filteredData = data.filter(item => {
    if (!item.created_at) return false;
    const date = new Date(item.created_at)
    if (timeRange === 'day') return isAfter(date, subDays(now, 1))
    if (timeRange === 'week') return isAfter(date, subDays(now, 7))
    if (timeRange === 'month') return isAfter(date, subDays(now, 30))
    return true
  }).map(item => {
    // If temperature is -127 or invalid/null, clean it to null so the chart doesn't dive to -127
    const isValidTemp = item.temperature != null && item.temperature > -50 && item.temperature < 80;
    return {
      ...item,
      rawTemperature: item.temperature,
      temperature: isValidTemp ? Number(Number(item.temperature).toFixed(1)) : null,
      formattedTime: format(new Date(item.created_at), timeRange === 'day' ? 'HH:mm' : 'dd/MM HH:mm')
    }
  })

  // Calculate statistics (Min, Max, Avg)
  const validTemps = filteredData.map(d => d.temperature).filter(t => t != null)
  const minTemp = validTemps.length ? Math.min(...validTemps).toFixed(1) : '--'
  const maxTemp = validTemps.length ? Math.max(...validTemps).toFixed(1) : '--'
  const avgTemp = validTemps.length ? (validTemps.reduce((a, b) => a + b, 0) / validTemps.length).toFixed(1) : '--'

  // Detect past completed outages in filtered data (safe for Recharts ReferenceArea)
  const completedOutages = []
  for (let i = 1; i < filteredData.length; i++) {
    const prevTime = new Date(filteredData[i - 1].created_at)
    const currTime = new Date(filteredData[i].created_at)
    const diffMins = differenceInMinutes(currTime, prevTime)
    if (diffMins >= 5) {
      completedOutages.push({
        start: filteredData[i - 1].formattedTime,
        end: filteredData[i].formattedTime,
        startDate: prevTime,
        endDate: currTime,
        durationMins: diffMins,
        ongoing: false
      })
    }
  }

  // All outages including currently ongoing for the log table
  const allOutages = [...completedOutages]
  if (isOffline && currentStatus?.created_at) {
    const lastTime = new Date(currentStatus.created_at)
    allOutages.push({
      start: format(lastTime, timeRange === 'day' ? 'HH:mm' : 'dd/MM HH:mm'),
      end: 'כעת',
      startDate: lastTime,
      endDate: now,
      durationMins: diffSinceLastUpdate,
      ongoing: true
    })
  }

  // Sensor status flags
  const isWaterAlert = currentStatus?.water_level !== 'OK'
  const isTempError = currentStatus?.temperature == null || currentStatus?.temperature <= -50 || currentStatus?.temperature >= 80

  return (
    <div className="min-h-screen p-3 md:p-8 max-w-4xl mx-auto space-y-5 text-gray-800 bg-gray-50/50" dir="rtl">
      {/* Header */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-3 border-b gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold flex items-center gap-2 text-gray-900 tracking-tight">
            <Droplet className="text-blue-500 fill-blue-500" size={28} />
            Hydro Dashboard
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            עדכון אחרון: {currentStatus?.created_at ? format(new Date(currentStatus.created_at), 'dd/MM/yyyy HH:mm:ss') : 'טוען...'}
          </p>
        </div>

        {/* Telegram Bot Status Badge */}
        <div className="flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-xl text-xs font-semibold border border-blue-200 shadow-xs">
          <Send size={14} className="text-blue-600" />
          התראות מחוברות לטלגרם 🤖
        </div>
      </header>

      {/* Outage / Power Loss Banner (Visual only, no audio/popups) */}
      {isOffline && (
        <div className="bg-red-50 border-2 border-red-500 text-red-900 p-4 md:p-5 rounded-2xl flex items-start gap-3.5 shadow-xs">
          <ZapOff className="text-red-600 shrink-0 mt-0.5" size={30} />
          <div className="space-y-0.5">
            <h3 className="text-lg font-bold flex items-center gap-2 text-red-700">
              המערכת מנותקת / הפסקת חשמל
            </h3>
            <p className="text-sm">
              לא התקבל שידור מה-ESP32 כבר <strong>{diffSinceLastUpdate} דקות</strong> (עדכון נשלח כל 2 דקות בשגרה).
            </p>
            <p className="text-xs text-red-600 font-medium">
              התראות נשלחות אוטומטית לבוט הטלגרם שלך.
            </p>
          </div>
        </div>
      )}

      {/* Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        
        {/* Temperature Card */}
        <div className={`rounded-2xl shadow-xs p-5 flex flex-col justify-center items-center gap-2 border transition-all ${
          isTempError ? 'bg-red-50 border-red-300 text-red-800' : 'bg-white border-gray-200/70'
        }`}>
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-500">
            <Thermometer size={20} className={isTempError ? 'text-red-500' : 'text-orange-500'} />
            טמפרטורת מים
          </div>
          
          {isTempError ? (
            <div className="text-center space-y-1">
              <div className="text-2xl font-black text-red-600 flex items-center justify-center gap-1.5">
                <AlertTriangle size={24} />
                שגיאת חיישן
              </div>
              <p className="text-xs text-red-500 font-medium">
                חיישן מנותק (-127)
              </p>
            </div>
          ) : (
            <div className="text-5xl font-black text-gray-900 tracking-tight">
              {currentStatus?.temperature != null ? `${Number(currentStatus.temperature).toFixed(1)}°` : '--'}
            </div>
          )}
        </div>

        {/* Water Level Card */}
        <div className={`rounded-2xl shadow-xs p-5 flex flex-col justify-center items-center gap-2 text-white transition-all ${
          isWaterAlert ? 'bg-red-500' : 'bg-emerald-600'
        }`}>
          <div className="flex items-center gap-2 text-sm font-semibold text-white/90">
            <Droplet size={20} />
            מפלס מים (מצוף)
          </div>
          <div className="text-3xl font-black flex items-center gap-2 tracking-tight">
            {isWaterAlert ? (
              <>
                <AlertTriangle size={28} /> חסרים מים!
              </>
            ) : (
              <>
                <CheckCircle size={28} /> מפלס תקין
              </>
            )}
          </div>
        </div>
      </div>

      {/* Chart Section */}
      <div className="bg-white rounded-2xl shadow-xs border border-gray-200/70 p-4 md:p-6 space-y-4">
        
        {/* Chart Header & Filter Controls */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg md:text-xl font-bold text-gray-900 flex items-center gap-1.5">
                <Activity size={20} className="text-blue-500" />
                היסטוריית טמפרטורה
              </h2>
              {completedOutages.length > 0 && (
                <span className="text-xs font-semibold bg-rose-100 text-rose-700 px-2.5 py-0.5 rounded-full">
                  {completedOutages.length} הפסקות חשמל
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              האזורים המסומנים באדום מייצגים פרקי זמן ללא שידור
            </p>
          </div>

          {/* Time Filter Buttons */}
          <div className="flex bg-gray-100/80 rounded-xl p-1 gap-1 self-stretch sm:self-auto justify-center">
            {[
              { id: 'day', label: 'יום' },
              { id: 'week', label: 'שבוע' },
              { id: 'month', label: 'חודש' },
              { id: 'all', label: 'הכל' }
            ].map(range => (
              <button
                key={range.id}
                onClick={() => setTimeRange(range.id)}
                className={`flex-1 sm:flex-initial px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  timeRange === range.id 
                    ? 'bg-white shadow-xs text-blue-600' 
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        {/* Quick Stats Bar */}
        <div className="grid grid-cols-3 gap-2 p-2.5 bg-gray-50/80 rounded-xl border border-gray-100 text-center">
          <div className="flex flex-col items-center justify-center">
            <span className="text-2xs text-gray-400 font-semibold flex items-center gap-1">
              <TrendingDown size={12} className="text-blue-500" /> מינימום
            </span>
            <span className="text-sm md:text-base font-extrabold text-blue-600 mt-0.5">
              {minTemp !== '--' ? `${minTemp}°` : '--'}
            </span>
          </div>
          <div className="flex flex-col items-center justify-center border-x border-gray-200/60">
            <span className="text-2xs text-gray-400 font-semibold flex items-center gap-1">
              <Activity size={12} className="text-gray-400" /> ממוצע
            </span>
            <span className="text-sm md:text-base font-extrabold text-gray-800 mt-0.5">
              {avgTemp !== '--' ? `${avgTemp}°` : '--'}
            </span>
          </div>
          <div className="flex flex-col items-center justify-center">
            <span className="text-2xs text-gray-400 font-semibold flex items-center gap-1">
              <TrendingUp size={12} className="text-orange-500" /> מקסימום
            </span>
            <span className="text-sm md:text-base font-extrabold text-orange-600 mt-0.5">
              {maxTemp !== '--' ? `${maxTemp}°` : '--'}
            </span>
          </div>
        </div>

        {/* Modern Area Chart */}
        <div className="h-[320px] md:h-[380px] w-full pt-2" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={filteredData} margin={{ top: 12, right: 10, left: -15, bottom: 5 }}>
              <defs>
                <linearGradient id="tempGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35}/>
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0}/>
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
              
              <XAxis 
                dataKey="formattedTime" 
                tick={{ fontSize: 11, fill: '#94a3b8' }} 
                axisLine={{ stroke: '#e2e8f0' }}
                tickLine={false}
                minTickGap={25}
              />
              
              <YAxis 
                domain={[dataMin => Math.floor(dataMin - 0.5), dataMax => Math.ceil(dataMax + 0.5)]}
                tickFormatter={(value) => `${value}°`} 
                tick={{ fontSize: 11, fill: '#94a3b8' }} 
                axisLine={false}
                tickLine={false}
              />
              
              <Tooltip 
                contentStyle={{ 
                  borderRadius: '14px', 
                  border: '1px solid #e2e8f0', 
                  boxShadow: '0 8px 20px -4px rgba(0, 0, 0, 0.1)',
                  padding: '8px 12px',
                  backgroundColor: 'rgba(255, 255, 255, 0.96)',
                  backdropFilter: 'blur(6px)'
                }}
                labelStyle={{ fontWeight: '700', color: '#1e293b', marginBottom: '2px', fontSize: '12px' }}
                formatter={(val) => [val != null ? `${Number(val).toFixed(1)}°C` : 'שגיאת חיישן', 'טמפרטורה']}
              />

              {/* Shaded clean rose areas for outages (NO overlapping text labels!) */}
              {completedOutages.map((outage, idx) => (
                <ReferenceArea 
                  key={idx}
                  x1={outage.start} 
                  x2={outage.end} 
                  fill="#fecdd3" 
                  fillOpacity={0.35}
                  stroke="#fb7185"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
              ))}

              <Area 
                type="monotone" 
                dataKey="temperature" 
                stroke="#2563eb" 
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#tempGradient)"
                dot={false}
                activeDot={{ r: 6, fill: '#2563eb', stroke: '#ffffff', strokeWidth: 2 }}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Chart Legend Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-xs text-gray-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block"></span>
              טמפרטורת מים
            </span>
            {completedOutages.length > 0 && (
              <span className="flex items-center gap-1.5 font-medium">
                <span className="w-2.5 h-2.5 rounded-sm bg-rose-200 border border-rose-400 inline-block"></span>
                הפסקות חשמל (מוצלל)
              </span>
            )}
          </div>
          <span className="text-gray-400 text-2xs">פירוט מלא ביומן למטה</span>
        </div>
      </div>

      {/* Outage Log Card */}
      <div className="bg-white rounded-2xl shadow-xs border border-gray-200/70 p-4 md:p-6 space-y-3.5">
        <h3 className="text-base md:text-lg font-bold flex items-center gap-2 text-gray-900">
          <Clock className="text-gray-400" size={20} />
          יומן הפסקות חשמל וזמני ניתוק
        </h3>

        {allOutages.length === 0 ? (
          <p className="text-xs md:text-sm text-gray-500 bg-gray-50/80 p-3.5 rounded-xl text-center">
            לא זוהו הפסקות חשמל או ניתוקים בטווח הזמן שנבחר. המערכת פעלה ברציפות! ✔️
          </p>
        ) : (
          <div className="space-y-2.5">
            {allOutages.map((outage, idx) => (
              <div 
                key={idx}
                className={`p-3 md:p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition-all ${
                  outage.ongoing ? 'bg-red-50/70 border-red-200' : 'bg-gray-50/70 border-gray-200/80'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <ZapOff size={18} className={outage.ongoing ? 'text-red-600' : 'text-gray-400'} />
                  <div>
                    <span className="font-bold text-xs md:text-sm text-gray-900 block sm:inline">
                      {outage.ongoing ? 'הפסקת חשמל פעילה כעת ⚠️' : 'הפסקת חשמל שהסתיימה'}
                    </span>
                    <span className="text-2xs md:text-xs text-gray-500 sm:mr-2">
                      {format(outage.startDate, 'dd/MM HH:mm')} עד {outage.ongoing ? 'עכשיו' : format(outage.endDate, 'dd/MM HH:mm')}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <span className={`px-2.5 py-0.5 rounded-full text-2xs md:text-xs font-bold ${
                    outage.ongoing ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-700'
                  }`}>
                    משך: {outage.durationMins} דקות
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}

export default App
