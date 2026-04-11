import jsBridge from './js-bridge'

// 调用iOS方法
jsBridge.closeWebView((result) => {
  console.log('closeWebView:', result)
})

jsBridge.saveImageToPhoto(
  {
    imgUrl: 'https://www.baidu.com'
  },
  (result) => {
    console.log('saveImageToPhoto:', result)
  }
)

// 注册H5方法供iOS调用
jsBridge.registerHandler('h5Method', (data, callback) => {
  console.log('iOS调用H5方法:', data)
  callback?.({ success: true })
})
