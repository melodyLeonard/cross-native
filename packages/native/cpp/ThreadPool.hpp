#pragma once

#include <thread>
#include <vector>
#include <queue>
#include <mutex>
#include <condition_variable>
#include <future>
#include <functional>
#include <atomic>
#include <chrono>

namespace crossnative {

/**
 * Task priority levels
 * Lower number = higher priority
 */
enum class TaskPriority {
  IMMEDIATE = 0,   // Run on current thread
  HIGH = 1,        // Urgent background work
  NORMAL = 2,      // Standard computation
  LOW = 3,         // Background work
  BACKGROUND = 4   // Lowest priority, can be delayed
};

/**
 * Task structure for thread pool
 */
struct Task {
  std::function<void()> func;
  TaskPriority priority = TaskPriority::NORMAL;
  std::chrono::steady_clock::time_point enqueueTime;
  std::string taskId;
  std::atomic<bool>* cancelled = nullptr;
  
  bool operator<(const Task& other) const {
    // For min-heap: lower priority number = higher priority
    return priority > other.priority;
  }
};

/**
 * ThreadPool - Manages worker threads for async native execution
 * 
 * Features:
 * - Priority queue with work stealing
 * - Task cancellation support
 * - Dynamic thread count
 * - Graceful shutdown
 */
class ThreadPool {
public:
  explicit ThreadPool(size_t numThreads);
  ~ThreadPool();
  
  /**
   * Submit a task with priority
   * Returns a future for the result
   */
  template<typename F, typename... Args>
  auto enqueue(TaskPriority priority, F&& f, Args&&... args) 
    -> std::future<typename std::invoke_result_t<F, Args...>> {
    
    using return_type = typename std::invoke_result_t<F, Args...>;
    
    auto task = std::make_shared<std::packaged_task<return_type()>>(
      std::bind(std::forward<F>(f), std::forward<Args>(args)...)
    );
    
    std::future<return_type> result = task->get_future();
    
    {
      std::unique_lock<std::mutex> lock(queueMutex_);
      
      if (stop_) {
        throw std::runtime_error("Cannot enqueue on stopped ThreadPool");
      }
      
      Task t;
      t.func = [task](){ (*task)(); };
      t.priority = priority;
      t.enqueueTime = std::chrono::steady_clock::now();
      t.taskId = generateTaskId();
      
      tasks_.push(std::move(t));
    }
    
    condition_.notify_one();
    return result;
  }
  
  /**
   * Convenience overload for normal priority
   */
  template<typename F, typename... Args>
  auto enqueue(F&& f, Args&&... args) {
    return enqueue(TaskPriority::NORMAL, std::forward<F>(f), std::forward<Args>(args)...);
  }
  
  /** Get current queue size */
  size_t queueSize() const {
    std::lock_guard<std::mutex> lock(queueMutex_);
    return tasks_.size();
  }
  
  /** Get number of active (working) threads */
  size_t activeCount() const {
    return activeCount_.load();
  }
  
  /** Get total thread pool size */
  size_t size() const {
    return workers_.size();
  }
  
  /** Cancel all pending tasks */
  void cancelAll();
  
  /** Shutdown the pool gracefully */
  void shutdown();

private:
  std::vector<std::thread> workers_;
  std::priority_queue<Task> tasks_;
  mutable std::mutex queueMutex_;
  std::condition_variable condition_;
  std::atomic<bool> stop_ = false;
  std::atomic<size_t> activeCount_ = 0;
  
  static std::string generateTaskId();
  void workerLoop();
};

} // namespace crossnative
