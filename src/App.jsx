import React, { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import { format, subDays, isAfter, differenceInMinutes } from 'date-fns'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea } from 'recharts'
import { Droplet, Thermometer, AlertTriangle, CheckCircle, WifiOff, ZapOff, Clock, Send } from 'lucide-react'

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

  // Initial fetch and Supabase Realtime subscription
  useEffect(() => {
    fetchData()
    
    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hydro_data' }, payload => {
        setData(prev => [...prev, payload.new])
        setCurrentStatus(payload.new)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  async function fetchData() {
    let { data: hydroData, error } = await supabase
      .from('hydro_data')
      .select('*')
      .order('created_at', { ascending: true })

    if (error) {
      console.log('error', error)
    } else if (hydroData) {
      setData(hydroData)
      if (hydroData.length > 0) {
        setCurrentStatus(hydroData[hydroData.length - 1])
      }
    }
  }

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
      temperature: isValidTemp ? Number(item.temperature) : null,
      formattedTime: format(new Date(item.created_at), timeRange === 'day' ? 'HH:mm' : 'dd/MM HH:mm')
    }
  })

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
    <div className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto space-y-6 text-gray-800" dir="rtl">
      {/* Header */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 border-b gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Droplet className="text-blue-500" size={32} />
            Hydro Dashboard
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            עדכון אחרון: {currentStatus?.created_at ? format(new Date(currentStatus.created_at), 'dd/MM/yyyy HH:mm:ss') : 'טוען...'}
          </p>
        </div>

        {/* Telegram Bot Status Badge */}
        <div className="flex items-center gap-2 bg-blue-50 text-blue-700 px-3.5 py-1.5 rounded-xl text-sm font-semibold border border-blue-200">
          <Send size={16} className="text-blue-600" />
          התראות מחוברות לטלגרם 🤖
        </div>
      </header>

      {/* Outage / Power Loss Banner (Visual only, no audio/popups) */}
      {isOffline && (
        <div className="bg-red-50 border-2 border-red-500 text-red-900 p-5 rounded-2xl flex items-start gap-4 shadow-sm">
          <ZapOff className="text-red-600 shrink-0 mt-1" size={34} />
          <div className="space-y-1">
            <h3 className="text-xl font-bold flex items-center gap-2 text-red-700">
              המערכת מנותקת / הפסקת חשמל
            </h3>
            <p className="text-base">
              לא התקבל שידור מה-ESP32 כבר <strong>{diffSinceLastUpdate} דקות</strong> (עדכון נשלח כל 2 דקות בשגרה).
            </p>
            <p className="text-sm text-red-600">
              התראות נשלחות אוטומטית לבוט הטלגרם שלך.
            </p>
          </div>
        </div>
      )}

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Temperature Card */}
        <div className={`rounded-2xl shadow-sm p-6 flex flex-col justify-center items-center gap-3 border transition-colors ${
          isTempError ? 'bg-red-50 border-red-300 text-red-800' : 'bg-white border-gray-100'
        }`}>
          <div className="flex items-center gap-2 text-lg font-medium text-gray-600">
            <Thermometer size={26} className={isTempError ? 'text-red-500' : 'text-orange-500'} />
            טמפרטורת מים
          </div>
          
          {isTempError ? (
            <div className="text-center space-y-1">
              <div className="text-3xl font-extrabold text-red-600 flex items-center justify-center gap-2">
                <AlertTriangle size={32} />
                שגיאת חיישן
              </div>
              <p className="text-sm text-red-500 font-medium">
                החיישן מנותק או לא מזוהה (-127)
              </p>
            </div>
          ) : (
            <div className="text-6xl font-black text-gray-900">
              {currentStatus?.temperature != null ? `${Number(currentStatus.temperature).toFixed(1)}°` : '--'}
            </div>
          )}
        </div>

        {/* Water Level Card */}
        <div className={`rounded-2xl shadow-sm p-6 flex flex-col justify-center items-center gap-3 text-white transition-colors ${
          isWaterAlert ? 'bg-red-500' : 'bg-emerald-600'
        }`}>
          <div className="flex items-center gap-2 text-lg font-medium">
            <Droplet size={26} />
            מפלס מים (מצוף)
          </div>
          <div className="text-4xl font-extrabold flex items-center gap-3">
            {isWaterAlert ? (
              <>
                <AlertTriangle size={36} /> חסרים מים!
              </>
            ) : (
              <>
                <CheckCircle size={36} /> מפלס תקין
              </>
            )}
          </div>
        </div>
      </div>

      {/* Chart Section */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              היסטוריית טמפרטורה
              {completedOutages.length > 0 && (
                <span className="text-xs font-semibold bg-red-100 text-red-700 px-2.5 py-0.5 rounded-full">
                  {completedOutages.length} הפסקות בעבר
                </span>
              )}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              האזורים המסומנים באדום בגרף מייצגים הפסקות שידור
            </p>
          </div>

          <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
            {[
              { id: 'day', label: 'יום' },
              { id: 'week', label: 'שבוע' },
              { id: 'month', label: 'חודש' },
              { id: 'all', label: 'הכל' }
            ].map(range => (
              <button
                key={range.id}
                onClick={() => setTimeRange(range.id)}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                  timeRange === range.id 
                    ? 'bg-white shadow-sm text-blue-600' 
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
        
        <div className="h-[380px] w-full" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={filteredData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="formattedTime" tick={{ fontSize: 12 }} />
              <YAxis domain={['auto', 'auto']} tickFormatter={(value) => `${value}°`} tick={{ fontSize: 12 }} />
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                labelStyle={{ fontWeight: 'bold', color: '#1f2937' }}
                formatter={(val) => [val != null ? `${val}°` : 'שגיאת חיישן', 'טמפרטורה']}
              />

              {/* Shaded red areas only for completed outages where coordinates exist */}
              {completedOutages.map((outage, idx) => (
                <ReferenceArea 
                  key={idx}
                  x1={outage.start} 
                  x2={outage.end} 
                  fill="#fee2e2" 
                  fillOpacity={0.7}
                  stroke="#ef4444"
                  strokeDasharray="3 3"
                  label={{
                    value: `הפסקת חשמל (${outage.durationMins} דק')`,
                    position: 'insideTop',
                    fill: '#b91c1c',
                    fontSize: 11,
                    fontWeight: 600
                  }}
                />
              ))}

              <Line 
                type="monotone" 
                dataKey="temperature" 
                stroke="#2563eb" 
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 7 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Outage Log Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Clock className="text-gray-500" size={22} />
          יומן הפסקות חשמל וזמני ניתוק
        </h3>

        {allOutages.length === 0 ? (
          <p className="text-sm text-gray-500 bg-gray-50 p-4 rounded-xl text-center">
            לא זוהו הפסקות חשמל או ניתוקים בטווח הזמן שנבחר. המערכת פעלה ברציפות! ✔️
          </p>
        ) : (
          <div className="space-y-3">
            {allOutages.map((outage, idx) => (
              <div 
                key={idx}
                className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                  outage.ongoing ? 'bg-red-50 border-red-300' : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <ZapOff size={22} className={outage.ongoing ? 'text-red-600' : 'text-gray-500'} />
                  <div>
                    <span className="font-bold text-gray-900">
                      {outage.ongoing ? 'הפסקת חשמל פעילה כעת ⚠️' : 'הפסקת חשמל שהסתיימה'}
                    </span>
                    <p className="text-xs text-gray-500">
                      {format(outage.startDate, 'dd/MM/yyyy HH:mm')} עד {outage.ongoing ? 'עכשיו' : format(outage.endDate, 'dd/MM/yyyy HH:mm')}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                    outage.ongoing ? 'bg-red-600 text-white animate-pulse' : 'bg-gray-200 text-gray-700'
                  }`}>
                    משך זמן: {outage.durationMins} דקות
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
