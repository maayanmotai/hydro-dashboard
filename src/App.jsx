import React, { useEffect, useState, useRef } from 'react'
import { supabase } from './lib/supabaseClient'
import { format, subDays, isAfter, differenceInMinutes } from 'date-fns'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea } from 'recharts'
import { Droplet, Thermometer, AlertTriangle, CheckCircle, WifiOff, Bell, BellOff, ZapOff, Clock } from 'lucide-react'

// Play audio alarm tone on power outage
const playAlarmSound = () => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(600, ctx.currentTime)
    osc.frequency.setValueAtTime(900, ctx.currentTime + 0.2)
    osc.frequency.setValueAtTime(600, ctx.currentTime + 0.4)
    osc.frequency.setValueAtTime(900, ctx.currentTime + 0.6)
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.8)
  } catch (e) {
    console.error('Audio alert error:', e)
  }
}

function App() {
  const [data, setData] = useState([])
  const [currentStatus, setCurrentStatus] = useState(null)
  const [timeRange, setTimeRange] = useState('day')
  const [now, setNow] = useState(new Date())
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'granted'
  )
  const hasAlertedRef = useRef(false)

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

  // Request notification permission
  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined') {
      alert('הדפדפן שלך אינו תומך בהתראות Web Push')
      return
    }
    const permission = await Notification.requestPermission()
    if (permission === 'granted') {
      setNotificationsEnabled(true)
      new Notification('🔔 התראות הופעלו בהצלחה!', {
        body: 'תקבל התראה מידית אם תזוהה הפסקת חשמל או ניתוק במערכת ההידרופונית.',
        icon: '/favicon.svg'
      })
    } else {
      setNotificationsEnabled(false)
    }
  }

  // Offline / Power Outage calculation
  const diffSinceLastUpdate = currentStatus?.created_at 
    ? differenceInMinutes(now, new Date(currentStatus.created_at)) 
    : 0;
  const isOffline = currentStatus?.created_at ? diffSinceLastUpdate >= 5 : false;

  // Immediate Alert Trigger when power outage / offline is detected
  useEffect(() => {
    if (isOffline) {
      if (!hasAlertedRef.current) {
        hasAlertedRef.current = true
        playAlarmSound()
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('🚨 התראת הפסקת חשמל במערכת!', {
            body: `לא התקבלו נתונים מה-ESP32 כבר ${diffSinceLastUpdate} דקות. ייתכן שיש הפסקת חשמל!`,
            icon: '/favicon.svg',
            requireInteraction: true
          })
        }
      }
    } else {
      hasAlertedRef.current = false
    }
  }, [isOffline, diffSinceLastUpdate])

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

  // Detect outages / downtime periods in filtered data
  const outages = []
  for (let i = 1; i < filteredData.length; i++) {
    const prevTime = new Date(filteredData[i - 1].created_at)
    const currTime = new Date(filteredData[i].created_at)
    const diffMins = differenceInMinutes(currTime, prevTime)
    if (diffMins >= 5) {
      outages.push({
        start: filteredData[i - 1].formattedTime,
        end: filteredData[i].formattedTime,
        startDate: prevTime,
        endDate: currTime,
        durationMins: diffMins,
        ongoing: false
      })
    }
  }

  // If currently offline, add ongoing outage
  if (isOffline && currentStatus?.created_at) {
    const lastTime = new Date(currentStatus.created_at)
    outages.push({
      start: format(lastTime, timeRange === 'day' ? 'HH:mm' : 'dd/MM HH:mm'),
      end: format(now, timeRange === 'day' ? 'HH:mm' : 'dd/MM HH:mm'),
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

        {/* Notifications Button */}
        <button
          onClick={requestNotificationPermission}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
            notificationsEnabled 
              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
              : 'bg-blue-600 text-white hover:bg-blue-700 shadow'
          }`}
        >
          {notificationsEnabled ? (
            <>
              <Bell size={18} />
              התראות פוש מופעלות
            </>
          ) : (
            <>
              <BellOff size={18} />
              הפעל התראות פוש לטלפון
            </>
          )}
        </button>
      </header>

      {/* Outage / Power Loss Banner */}
      {isOffline && (
        <div className="bg-red-50 border-2 border-red-500 text-red-900 p-5 rounded-2xl flex items-start gap-4 shadow-lg animate-pulse">
          <ZapOff className="text-red-600 shrink-0 mt-1" size={36} />
          <div className="space-y-1">
            <h3 className="text-xl font-bold flex items-center gap-2 text-red-700">
              התראת הפסקת חשמל / מערכת מנותקת!
            </h3>
            <p className="text-base">
              לא התקבל שום אות מה-ESP32 כבר <strong>{diffSinceLastUpdate} דקות</strong> (העדכון הרגיל נשלח כל 2 דקות).
            </p>
            <p className="text-sm text-red-600">
              סביר להניח שיש הפסקת חשמל במקום, תקלת ספק כוח, או ניתוק ב-WiFi.
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
              {outages.length > 0 && (
                <span className="text-xs font-semibold bg-red-100 text-red-700 px-2.5 py-0.5 rounded-full">
                  זוהו {outages.length} הפסקות חשמל בגרף
                </span>
              )}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              האזורים המסומנים באדום מייצגים פרקי זמן שבהם הבקר לא שידר (הפסקת חשמל/ניתוק)
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

              {/* Shaded red areas for detected power outages */}
              {outages.map((outage, idx) => (
                <ReferenceArea 
                  key={idx}
                  x1={outage.start} 
                  x2={outage.end} 
                  fill="#fee2e2" 
                  fillOpacity={0.7}
                  stroke="#ef4444"
                  strokeDasharray="3 3"
                  label={{
                    value: outage.ongoing ? `הפסקת חשמל (${outage.durationMins} דק')` : `הפסקת חשמל (${outage.durationMins} דק')`,
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

        {outages.length === 0 ? (
          <p className="text-sm text-gray-500 bg-gray-50 p-4 rounded-xl text-center">
            לא זוהו הפסקות חשמל או ניתוקים בטווח הזמן שנבחר. המערכת פעלה ברציפות! ✔️
          </p>
        ) : (
          <div className="space-y-3">
            {outages.map((outage, idx) => (
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
